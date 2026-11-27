import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { getConfig } from "./config";
import { mapPool } from "./http";
import { resolveGithubLogin, searchPullRequests, type GhPullRequest } from "./github";
import { listZohoProjects, listZohoTasks, listZohoUsers, zohoTaskUrl, type ZohoTaskData } from "./zoho";

export type SyncSource = "GITHUB" | "ZOHO";
export type SyncOpts = {
  full?: boolean;
  trigger: string;
  /**
   * Traslape generoso (1 día) para atrapar cambios que la búsqueda de GitHub tarda en indexar. La sincronización
   * automática usa uno corto (20 min) para ser rápida; el cron diario y el botón manual usan el generoso.
   */
  deep?: boolean;
};
// OK = todo bien · WARNING = terminó, pero con avisos que no afectan los datos (p. ej. alguien sin usuario de GitHub)
// ERROR = alguna consulta falló y faltan datos por traer · SKIPPED = no se ejecutó.
export type SyncOutcome = {
  source: SyncSource;
  status: "OK" | "WARNING" | "ERROR" | "SKIPPED";
  /** PRs / tareas nuevos o modificados que se guardaron en esta corrida. */
  items: number;
  message?: string;
};
type RunResult = { items: number; warnings: string[]; errors: string[] };

const STALE_RUN_MS = 10 * 60 * 1000; // las funciones duran máx. 5 min
const DAY = 24 * 3600 * 1000;
const LIGHT_OVERLAP_MS = 20 * 60 * 1000;
const GITHUB_CONCURRENCY = 4; // peticiones a GitHub en paralelo (con más se arriesgan límites secundarios)
const ZOHO_CONCURRENCY = 3;
const DB_CHUNK = 100;

const overlapMs = (opts: SyncOpts) => (opts.deep ? DAY : LIGHT_OVERLAP_MS);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const timestamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const chunks = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

async function sinceDate(source: SyncSource, opts: SyncOpts): Promise<Date> {
  const lookback = new Date(Date.now() - env.syncLookbackDays * DAY);
  if (opts.full) return lookback;
  const last = await db.syncRun.findFirst({
    where: { source, status: { in: ["OK", "WARNING"] } }, // WARNING también terminó y trajo todo
    orderBy: { startedAt: "desc" },
  });
  return last ? new Date(Math.max(last.startedAt.getTime() - overlapMs(opts), lookback.getTime())) : lookback;
}

async function runTracked(
  source: SyncSource,
  trigger: string,
  fn: () => Promise<RunResult>,
): Promise<SyncOutcome> {
  await db.syncRun.updateMany({
    where: { source, status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
    data: { status: "ERROR", error: "Interrumpida (tiempo agotado)", finishedAt: new Date() },
  });
  const running = await db.syncRun.findFirst({ where: { source, status: "RUNNING" } });
  if (running) {
    const message = "Ya había una sincronización en curso; este intento se omitió";
    // La sincronización automática se omite en silencio (pasa a menudo y no aporta nada al historial).
    if (trigger === "auto" || trigger === "refresh") return { source, status: "SKIPPED", items: 0, message };
    // En los demás casos se deja constancia. Nada se pierde: los cursores por persona
    // hacen que la siguiente sincronización complete lo pendiente.
    await db.syncRun.create({ data: { source, trigger, status: "SKIPPED", error: message, finishedAt: new Date() } });
    return { source, status: "SKIPPED", items: 0, message };
  }

  const run = await db.syncRun.create({ data: { source, trigger, status: "RUNNING" } });
  try {
    const { items, warnings, errors } = await fn();
    const status = errors.length ? "ERROR" : warnings.length ? "WARNING" : "OK";
    const all = [...new Set([...errors, ...warnings])]; // primero lo que falló, sin repetidos
    const error = all.length ? all.join(" | ").slice(0, 1000) : null;
    await db.syncRun.update({ where: { id: run.id }, data: { status, items, error, finishedAt: new Date() } });
    return { source, status, items, message: error ?? undefined };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.syncRun.update({
      where: { id: run.id },
      data: { status: "ERROR", error: message.slice(0, 1000), finishedAt: new Date() },
    });
    return { source, status: "ERROR", items: 0, message };
  }
}

// ───────────────────────────── GitHub ─────────────────────────────

type MemberRow = { id: string; githubLogin: string | null; email: string; archivedAt: Date | null; githubSyncedAt: Date | null };

export async function syncGithub(opts: SyncOpts): Promise<SyncOutcome> {
  const cfg = await getConfig();
  if (!cfg.githubConfigured) {
    return { source: "GITHUB", status: "SKIPPED", items: 0, message: "El token de GitHub no está configurado" };
  }
  return runTracked("GITHUB", opts.trigger, async () => {
    const warnings: string[] = []; // avisos: no afectan los datos traídos
    const errors: string[] = []; // fallas: faltan datos y se reintentarán
    const startedAt = new Date(); // el cursor de cada persona avanza hasta aquí, no hasta que termine la corrida
    const lookback = new Date(startedAt.getTime() - env.syncLookbackDays * DAY);
    const org = cfg.github.org ? ` org:${cfg.github.org}` : "";

    const all: MemberRow[] = await db.member.findMany({
      select: { id: true, githubLogin: true, email: true, archivedAt: true, githubSyncedAt: true },
    });
    const byLogin = new Map<string, string>();
    for (const m of all) if (m.githubLogin) byLogin.set(m.githubLogin, m.id);

    // 1) Descubrir logins faltantes a partir del correo.
    for (const m of all.filter((x) => !x.githubLogin && !x.archivedAt)) {
      try {
        const login = await resolveGithubLogin(m.email);
        if (login && !byLogin.has(login)) {
          await db.member.update({ where: { id: m.id }, data: { githubLogin: login } });
          byLogin.set(login, m.id);
          m.githubLogin = login;
        } else if (!login) {
          warnings.push(`Sin usuario de GitHub para ${m.email} (captúralo manualmente)`);
        }
      } catch (e) {
        warnings.push(`Resolver ${m.email}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 2) Traer PRs creados y revisados por cada miembro activo, varios a la vez.
    const targets = all.filter((x) => x.githubLogin && !x.archivedAt);
    const backfilled: string[] = [];
    let items = 0;

    await mapPool(targets, GITHUB_CONCURRENCY, async (m) => {
      const login = m.githubLogin!;
      // Sin cursor (persona nueva, restaurada o con usuario cambiado) o sync completa: todo el periodo.
      // Con cursor: desde ahí, con un traslape corto; el cursor tiene hora exacta, no solo día.
      const pending = Boolean(opts.full) || !m.githubSyncedAt;
      const from = pending ? lookback : new Date(Math.max(m.githubSyncedAt!.getTime() - overlapMs(opts), lookback.getTime()));
      const build = (since: string) => [
        `is:pr author:${login}${org} updated:>=${since}`,
        `is:pr reviewed-by:${login} -author:${login}${org} updated:>=${since}`,
      ];

      const found = new Map<string, GhPullRequest>();
      const collect = async (since: string) => {
        for (const q of build(since)) {
          for await (const { pr, total } of searchPullRequests(q)) {
            found.set(pr.id, pr);
            if (total > 1000) warnings.push(`Más de 1000 resultados para ${login}: reduce SYNC_LOOKBACK_DAYS`);
          }
        }
      };
      try {
        try {
          await collect(pending ? dateOnly(from) : timestamp(from));
        } catch (e) {
          // Si GitHub rechazara el formato con hora, se reintenta con solo la fecha (más amplio, mismo resultado).
          const msg = e instanceof Error ? e.message : "";
          if (!pending && /validation|invalid|unprocessable|cannot parse/i.test(msg)) {
            found.clear();
            await collect(dateOnly(from));
          } else throw e;
        }
        // Ojo: se espera primero y se suma después; `items += await …` leería `items` antes de esperar y,
        // con varias personas en paralelo, perdería sumas.
        const saved = await savePrs([...found.values()], byLogin);
        items += saved;
        if (pending) backfilled.push(login);
        // Si algo falló arriba, el cursor no avanza y la próxima corrida reintenta desde el mismo punto.
        await db.member.update({ where: { id: m.id }, data: { githubSyncedAt: startedAt } });
      } catch (e) {
        errors.push(`${login}: ${e instanceof Error ? e.message : e}`);
      }
    });

    // 3) Reasignar PRs/reviews históricos de las personas cuyo historial se acaba de traer.
    for (const login of backfilled) {
      const memberId = byLogin.get(login)!;
      await db.pullRequest.updateMany({ where: { authorLogin: login, memberId: null }, data: { memberId } });
      await db.prReview.updateMany({ where: { reviewerLogin: login, memberId: null }, data: { memberId } });
    }
    return { items, warnings, errors };
  });
}

function prFields(pr: GhPullRequest, byLogin: Map<string, string>) {
  const author = (pr.author?.login ?? "ghost").toLowerCase();
  const reviews = (pr.reviews.nodes ?? []).filter(
    (r): r is NonNullable<typeof r> =>
      !!r && !!r.submittedAt && r.state !== "PENDING" && !!r.author?.login && r.author.login.toLowerCase() !== author,
  );
  const firstReviewAt = reviews.length
    ? new Date(Math.min(...reviews.map((r) => new Date(r.submittedAt!).getTime())))
    : null;
  const data = {
    repo: pr.repository.nameWithOwner,
    number: pr.number,
    title: pr.title.slice(0, 500),
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    authorLogin: author,
    memberId: byLogin.get(author) ?? null,
    createdAtGh: new Date(pr.createdAt),
    updatedAtGh: new Date(pr.updatedAt),
    mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
    closedAt: pr.closedAt ? new Date(pr.closedAt) : null,
    firstReviewAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commentsCount: pr.comments.totalCount,
  };
  return { data, reviews };
}

/**
 * Guarda PRs en lotes: una consulta para saber cuáles ya existen, una inserción masiva para los nuevos, una
 * transacción para los modificados y una inserción masiva de reviews. Los PRs que no cambiaron se omiten.
 * Devuelve cuántos PRs se crearon o actualizaron.
 */
async function savePrs(prs: GhPullRequest[], byLogin: Map<string, string>): Promise<number> {
  let changed = 0;
  for (const batch of chunks(prs, DB_CHUNK)) {
    const existing = await db.pullRequest.findMany({
      where: { githubId: { in: batch.map((p) => p.id) } },
      select: { id: true, githubId: true, updatedAtGh: true, memberId: true },
    });
    const have = new Map(existing.map((e) => [e.githubId, e]));

    const toCreate: Array<ReturnType<typeof prFields>["data"] & { githubId: string }> = [];
    const toUpdate: Array<{ id: string; data: ReturnType<typeof prFields>["data"] }> = [];
    const touched: Array<{ pr: GhPullRequest; reviews: ReturnType<typeof prFields>["reviews"] }> = [];
    for (const pr of batch) {
      const { data, reviews } = prFields(pr, byLogin);
      const cur = have.get(pr.id);
      if (!cur) {
        toCreate.push({ githubId: pr.id, ...data });
        touched.push({ pr, reviews });
      } else if (cur.updatedAtGh < data.updatedAtGh || cur.memberId !== data.memberId) {
        toUpdate.push({ id: cur.id, data });
        touched.push({ pr, reviews });
      }
    }
    if (!touched.length) continue;

    if (toCreate.length) await db.pullRequest.createMany({ data: toCreate, skipDuplicates: true });
    for (const part of chunks(toUpdate, 50)) {
      await db.$transaction(part.map((u) => db.pullRequest.update({ where: { id: u.id }, data: u.data })));
    }

    // Reviews de los PRs nuevos o modificados (las ya guardadas se omiten por su id de GitHub).
    const idRows = await db.pullRequest.findMany({
      where: { githubId: { in: touched.map((t) => t.pr.id) } },
      select: { id: true, githubId: true },
    });
    const idOf = new Map(idRows.map((r) => [r.githubId, r.id]));
    const reviewRows = touched.flatMap(({ pr, reviews }) =>
      reviews.flatMap((r) => {
        const pullRequestId = idOf.get(pr.id);
        if (!pullRequestId) return [];
        const reviewer = r.author!.login.toLowerCase();
        return [
          {
            githubId: r.id,
            pullRequestId,
            reviewerLogin: reviewer,
            memberId: byLogin.get(reviewer) ?? null,
            state: r.state,
            submittedAt: new Date(r.submittedAt!),
          },
        ];
      }),
    );
    for (const part of chunks(reviewRows, 500)) await db.prReview.createMany({ data: part, skipDuplicates: true });
    changed += touched.length;
  }
  return changed;
}

// ───────────────────────────── Zoho ─────────────────────────────

export async function syncZoho(opts: SyncOpts): Promise<SyncOutcome> {
  const cfg = await getConfig();
  if (!cfg.zohoConfigured) {
    return { source: "ZOHO", status: "SKIPPED", items: 0, message: "Credenciales de Zoho no configuradas" };
  }
  const zoho = cfg.zoho;
  return runTracked("ZOHO", opts.trigger, async () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const startedAt = new Date();
    const sinceMs = (await sinceDate("ZOHO", opts)).getTime();

    const members = await db.member.findMany();
    // Las tareas se consultan por proyecto, no por persona: si alguien activo no tiene su historial
    // de Zoho, esta corrida trae todas las tareas (una sola vez); si no, solo las modificadas.
    const fetchAll = opts.full || members.some((m) => !m.archivedAt && !m.zohoSyncedAt);
    const zUsers = await listZohoUsers(zoho);
    const idByEmail = new Map(zUsers.map((u) => [u.email, u.id]));

    // 1) Ligar miembro <-> usuario de Zoho por correo.
    const byZohoId = new Map<string, string>();
    const byEmail = new Map<string, string>();
    for (const m of members) {
      const email = (m.zohoEmail ?? m.email).toLowerCase();
      byEmail.set(email, m.id);
      const zid = idByEmail.get(email) ?? m.zohoUserId ?? null;
      if (zid) byZohoId.set(zid, m.id);
      if (zid !== m.zohoUserId && !m.archivedAt) {
        await db.member.update({ where: { id: m.id }, data: { zohoUserId: zid } });
      }
      if (!zid && !m.archivedAt) warnings.push(`${m.email} no existe como usuario en Zoho`);
    }

    const ownersOf = (t: ZohoTaskData): Set<string> => {
      const ids = new Set<string>();
      for (const o of t.owners) {
        const id = (o.id && byZohoId.get(o.id)) || (o.zpuid && byZohoId.get(o.zpuid)) || (o.email && byEmail.get(o.email));
        if (id) ids.add(id);
      }
      return ids;
    };

    // 2) Tareas por proyecto (varios a la vez); solo se guardan las que tienen al menos un miembro como responsable.
    let items = 0;
    const projects = await listZohoProjects(zoho);
    let projectFailed = false;
    await mapPool(projects, ZOHO_CONCURRENCY, async (p) => {
      try {
        const tasks: ZohoTaskData[] = [];
        for await (const t of listZohoTasks(zoho, p.id, fetchAll ? undefined : sinceMs)) tasks.push(t);

        for (const batch of chunks(tasks, DB_CHUNK)) {
          const existing = await db.zohoTask.findMany({
            where: { zohoId: { in: batch.map((t) => t.zohoId) } },
            select: { zohoId: true, completedAt: true, updatedAtZ: true, members: { select: { id: true } } },
          });
          const have = new Map(existing.map((e) => [e.zohoId, e]));

          const work = batch.flatMap((t) => {
            const ids = ownersOf(t);
            const cur = have.get(t.zohoId);
            if (!ids.size && !cur) return []; // no es de nadie del equipo
            const sameMembers = cur && cur.members.length === ids.size && cur.members.every((m) => ids.has(m.id));
            if (cur && sameMembers && cur.updatedAtZ?.getTime() === t.updatedAt?.getTime()) return []; // sin cambios
            return [{ t, ids, cur }];
          });

          await mapPool(work, 5, async ({ t, ids, cur }) => {
            // Zoho no informa la fecha de cierre en el listado: si no viene, usamos la primera
            // vez que la vimos completada con su última modificación (aproximación).
            const completedAt = !t.completed ? null : (t.completedAt ?? cur?.completedAt ?? t.updatedAt ?? new Date());
            const data = {
              projectId: p.id,
              projectName: p.name,
              name: t.name.slice(0, 500),
              status: t.status,
              completed: t.completed,
              priority: t.priority,
              url: zohoTaskUrl(zoho, p.id, t.zohoId),
              createdAtZ: t.createdAt,
              updatedAtZ: t.updatedAt,
              completedAt,
              dueDate: t.dueDate,
            };
            const memberIds = [...ids].map((id) => ({ id }));
            await db.zohoTask.upsert({
              where: { zohoId: t.zohoId },
              create: { zohoId: t.zohoId, ...data, members: { connect: memberIds } },
              update: { ...data, members: { set: memberIds } },
            });
          });
          items += work.length;
        }
      } catch (e) {
        projectFailed = true;
        errors.push(`Proyecto ${p.name}: ${e instanceof Error ? e.message : e}`);
      }
    });
    // Solo si ningún proyecto falló se da por traído el historial.
    if (!projectFailed) {
      await db.member.updateMany({ where: { archivedAt: null }, data: { zohoSyncedAt: startedAt } });
    }
    return { items, warnings, errors };
  });
}

/** Cuántos compañeros activos todavía no tienen su historial traído (solo cuenta fuentes configuradas). */
export async function countPendingBackfill(scope: Prisma.MemberWhereInput = {}): Promise<number> {
  const cfg = await getConfig();
  const pending = [];
  if (cfg.githubConfigured) pending.push({ githubLogin: { not: null }, githubSyncedAt: null });
  if (cfg.zohoConfigured) pending.push({ zohoSyncedAt: null });
  if (!pending.length) return 0;
  return db.member.count({ where: { AND: [scope, { archivedAt: null, OR: pending }] } });
}

/** GitHub y Zoho en paralelo: son fuentes independientes y cada una lleva su propio control de concurrencia. */
export async function syncAll(opts: SyncOpts): Promise<[github: SyncOutcome, zoho: SyncOutcome]> {
  return Promise.all([syncGithub(opts), syncZoho(opts)]);
}
