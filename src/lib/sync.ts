import { db } from "./db";
import { env } from "./env";
import { resolveGithubLogin, searchPullRequests, type GhPullRequest } from "./github";
import { listZohoProjects, listZohoTasks, listZohoUsers, zohoTaskUrl } from "./zoho";

export type SyncSource = "GITHUB" | "ZOHO";
export type SyncOpts = { full?: boolean; trigger: string };
export type SyncOutcome = { source: SyncSource; status: "OK" | "ERROR" | "SKIPPED"; items: number; message?: string };

const STALE_RUN_MS = 10 * 60 * 1000; // las funciones duran máx. 5 min
const DAY = 24 * 3600 * 1000;

async function sinceDate(source: SyncSource, full?: boolean): Promise<Date> {
  const lookback = new Date(Date.now() - env.syncLookbackDays * DAY);
  if (full) return lookback;
  const last = await db.syncRun.findFirst({
    where: { source, status: "OK" },
    orderBy: { startedAt: "desc" },
  });
  // 1 día de traslape para no perder cambios en el borde.
  return last ? new Date(Math.max(last.startedAt.getTime() - DAY, lookback.getTime())) : lookback;
}

async function runTracked(
  source: SyncSource,
  trigger: string,
  fn: () => Promise<{ items: number; warnings: string[] }>,
): Promise<SyncOutcome> {
  await db.syncRun.updateMany({
    where: { source, status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
    data: { status: "ERROR", error: "Interrumpida (tiempo agotado)", finishedAt: new Date() },
  });
  const running = await db.syncRun.findFirst({ where: { source, status: "RUNNING" } });
  if (running) return { source, status: "SKIPPED", items: 0, message: "Ya hay una sincronización en curso" };

  const run = await db.syncRun.create({ data: { source, trigger, status: "RUNNING" } });
  try {
    const { items, warnings } = await fn();
    const status = warnings.length ? "ERROR" : "OK";
    const error = warnings.length ? warnings.join(" | ").slice(0, 1000) : null;
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
    const warnings: string[] = [];
    const since = (await sinceDate("GITHUB", opts.full)).toISOString().slice(0, 10);
    const org = env.githubOrg ? ` org:${env.githubOrg}` : "";

    const all = await db.member.findMany({ select: { id: true, githubLogin: true, email: true, archivedAt: true } });
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
      const queries = [
        `is:pr author:${login}${org} updated:>=${since}`,
        `is:pr reviewed-by:${login} -author:${login}${org} updated:>=${since}`,
      ];
      for (const q of queries) {
        try {
          for await (const { pr, total } of searchPullRequests(q)) {
            await upsertPr(pr, byLogin);
            items++;
            if (total > 1000 && items === 1) warnings.push(`Más de 1000 resultados para ${login}: reduce SYNC_LOOKBACK_DAYS`);
          }
        } catch (e) {
          warnings.push(`${login}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    // 3) Reasignar PRs/reviews históricos de miembros agregados después.
    for (const [login, memberId] of byLogin) {
      await db.pullRequest.updateMany({ where: { authorLogin: login, memberId: null }, data: { memberId } });
      await db.prReview.updateMany({ where: { reviewerLogin: login, memberId: null }, data: { memberId } });
    }
    return { items, warnings };
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
    const sinceMs = (await sinceDate("ZOHO", opts.full)).getTime();

    const members = await db.member.findMany();
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
    for (const p of projects) {
      try {
        for await (const t of listZohoTasks(p.id, opts.full ? undefined : sinceMs)) {
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
        warnings.push(`Proyecto ${p.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { items, warnings };
  });
}

export async function syncAll(opts: SyncOpts): Promise<SyncOutcome[]> {
  const gh = await syncGithub(opts);
  const zo = await syncZoho(opts);
  return [gh, zo];
}
