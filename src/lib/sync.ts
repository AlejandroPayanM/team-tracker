import { db } from "./db";
import { env } from "./env";
import { resolveGithubLogin, searchPullRequests, type GhPullRequest } from "./github";
import { listZohoProjects, listZohoTasks, listZohoUsers, zohoTaskUrl } from "./zoho";

export type SyncSource = "GITHUB" | "ZOHO";
export type SyncOpts = { full?: boolean; trigger: string };
// OK = todo bien · WARNING = terminó, pero con avisos que no afectan los datos (p. ej. alguien sin usuario de GitHub)
// ERROR = alguna consulta falló y faltan datos por traer · SKIPPED = no se ejecutó.
export type SyncOutcome = {
  source: SyncSource;
  status: "OK" | "WARNING" | "ERROR" | "SKIPPED";
  items: number;
  message?: string;
};
type RunResult = { items: number; warnings: string[]; errors: string[] };

const STALE_RUN_MS = 10 * 60 * 1000; // las funciones duran máx. 5 min
const DAY = 24 * 3600 * 1000;

async function sinceDate(source: SyncSource, full?: boolean): Promise<Date> {
  const lookback = new Date(Date.now() - env.syncLookbackDays * DAY);
  if (full) return lookback;
  const last = await db.syncRun.findFirst({
    where: { source, status: { in: ["OK", "WARNING"] } }, // WARNING también terminó y trajo todo
    orderBy: { startedAt: "desc" },
  });
  // 1 día de traslape para no perder cambios en el borde.
  return last ? new Date(Math.max(last.startedAt.getTime() - DAY, lookback.getTime())) : lookback;
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
    // Se deja constancia del intento omitido. Nada se pierde: los cursores por persona
    // hacen que la siguiente sincronización complete lo pendiente.
    const message = "Ya había una sincronización en curso; este intento se omitió";
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

export function syncGithub(opts: SyncOpts): Promise<SyncOutcome> {
  if (!env.githubConfigured) {
    return Promise.resolve({ source: "GITHUB", status: "SKIPPED", items: 0, message: "GITHUB_TOKEN no configurado" });
  }
  return runTracked("GITHUB", opts.trigger, async () => {
    const warnings: string[] = []; // avisos: no afectan los datos traídos
    const errors: string[] = []; // fallas: faltan datos y se reintentarán
    const startedAt = new Date(); // el cursor de cada persona avanza hasta aquí, no hasta que termine la corrida
    const lookback = new Date(startedAt.getTime() - env.syncLookbackDays * DAY);
    const org = env.githubOrg ? ` org:${env.githubOrg}` : "";

    const all = await db.member.findMany({
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

    // 2) Traer PRs creados y revisados por cada miembro activo.
    let items = 0;
    for (const m of all.filter((x) => x.githubLogin && !x.archivedAt)) {
      const login = m.githubLogin!;
      // Sin cursor (persona nueva, restaurada o con usuario cambiado) o sync completa: todo el periodo.
      // Con cursor: desde ahí, con 1 día de traslape para no perder cambios en el borde.
      const from =
        opts.full || !m.githubSyncedAt
          ? lookback
          : new Date(Math.max(m.githubSyncedAt.getTime() - DAY, lookback.getTime()));
      const since = from.toISOString().slice(0, 10);
      const queries = [
        `is:pr author:${login}${org} updated:>=${since}`,
        `is:pr reviewed-by:${login} -author:${login}${org} updated:>=${since}`,
      ];
      let failed = false;
      for (const q of queries) {
        try {
          for await (const { pr, total } of searchPullRequests(q)) {
            await upsertPr(pr, byLogin);
            items++;
            if (total > 1000) warnings.push(`Más de 1000 resultados para ${login}: reduce SYNC_LOOKBACK_DAYS`);
          }
        } catch (e) {
          failed = true;
          errors.push(`${login}: ${e instanceof Error ? e.message : e}`);
        }
      }
      // Si algo falló, el cursor no avanza y la próxima corrida reintenta desde el mismo punto.
      if (!failed) await db.member.update({ where: { id: m.id }, data: { githubSyncedAt: startedAt } });
    }

    // 3) Reasignar PRs/reviews históricos de miembros agregados después.
    for (const [login, memberId] of byLogin) {
      await db.pullRequest.updateMany({ where: { authorLogin: login, memberId: null }, data: { memberId } });
      await db.prReview.updateMany({ where: { reviewerLogin: login, memberId: null }, data: { memberId } });
    }
    return { items, warnings, errors };
  });
}

async function upsertPr(pr: GhPullRequest, byLogin: Map<string, string>): Promise<void> {
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
  const row = await db.pullRequest.upsert({
    where: { githubId: pr.id },
    create: { githubId: pr.id, ...data },
    update: data,
    select: { id: true },
  });
  for (const r of reviews) {
    const reviewer = r.author!.login.toLowerCase();
    const rd = {
      pullRequestId: row.id,
      reviewerLogin: reviewer,
      memberId: byLogin.get(reviewer) ?? null,
      state: r.state,
      submittedAt: new Date(r.submittedAt!),
    };
    await db.prReview.upsert({ where: { githubId: r.id }, create: { githubId: r.id, ...rd }, update: rd });
  }
}

// ───────────────────────────── Zoho ─────────────────────────────

export function syncZoho(opts: SyncOpts): Promise<SyncOutcome> {
  if (!env.zohoConfigured) {
    return Promise.resolve({ source: "ZOHO", status: "SKIPPED", items: 0, message: "Credenciales de Zoho no configuradas" });
  }
  return runTracked("ZOHO", opts.trigger, async () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const startedAt = new Date();
    const sinceMs = (await sinceDate("ZOHO", false)).getTime();

    const members = await db.member.findMany();
    // Las tareas se consultan por proyecto, no por persona: si alguien activo no tiene su historial
    // de Zoho, esta corrida trae todas las tareas (una sola vez); si no, solo las modificadas.
    const fetchAll = opts.full || members.some((m) => !m.archivedAt && !m.zohoSyncedAt);
    const zUsers = await listZohoUsers();
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

    // 2) Tareas por proyecto; solo se guardan las que tienen al menos un miembro como responsable.
    let items = 0;
    const projects = await listZohoProjects();
    let projectFailed = false;
    for (const p of projects) {
      try {
        for await (const t of listZohoTasks(p.id, fetchAll ? undefined : sinceMs)) {
          const ids = new Set<string>();
          for (const o of t.owners) {
            const id =
              (o.id && byZohoId.get(o.id)) || (o.zpuid && byZohoId.get(o.zpuid)) || (o.email && byEmail.get(o.email));
            if (id) ids.add(id);
          }
          const existing = await db.zohoTask.findUnique({ where: { zohoId: t.zohoId }, select: { id: true, completedAt: true } });
          if (!ids.size && !existing) continue;

          // Zoho no informa la fecha de cierre en el listado: si no viene, usamos la primera
          // vez que la vimos completada con su última modificación (aproximación).
          const completedAt = !t.completed
            ? null
            : (t.completedAt ?? existing?.completedAt ?? t.updatedAt ?? new Date());
          const data = {
            projectId: p.id,
            projectName: p.name,
            name: t.name.slice(0, 500),
            status: t.status,
            completed: t.completed,
            priority: t.priority,
            url: zohoTaskUrl(p.id, t.zohoId),
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
          items++;
        }
      } catch (e) {
        projectFailed = true;
        errors.push(`Proyecto ${p.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    // Solo si ningún proyecto falló se da por traído el historial.
    if (!projectFailed) {
      await db.member.updateMany({ where: { archivedAt: null }, data: { zohoSyncedAt: startedAt } });
    }
    return { items, warnings, errors };
  });
}

/** Cuántos compañeros activos todavía no tienen su historial traído (solo cuenta fuentes configuradas). */
export async function countPendingBackfill(): Promise<number> {
  const pending = [];
  if (env.githubConfigured) pending.push({ githubLogin: { not: null }, githubSyncedAt: null });
  if (env.zohoConfigured) pending.push({ zohoSyncedAt: null });
  if (!pending.length) return 0;
  return db.member.count({ where: { archivedAt: null, OR: pending } });
}

export async function syncAll(opts: SyncOpts): Promise<SyncOutcome[]> {
  const gh = await syncGithub(opts);
  const zo = await syncZoho(opts);
  return [gh, zo];
}
