import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { getScope } from "@/lib/access";
import { emptyStats, sumStats, weeklySeries } from "@/lib/stats";
import { listRepos, parseRepo } from "@/lib/filters";
import { formatDate, parseRange, relativeDays, shortDate } from "@/lib/weeks";
import { Badge, Bars, Card, ChartRail, Empty, Notice, RangeNav, STAT_GRID_5, Stat, prBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DeleteMemberForm, MemberForm, NoteForm, SubmitButton } from "@/components/forms";
import { archiveMemberAction, deleteNoteAction, restoreMemberAction, toggleNoteAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // las acciones de sincronización corren en esta ruta
const MIN_CHART_WEEKS = 12;

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; week?: string; repo?: string }>;
}) {
  const scope = await getScope();
  const isAdmin = scope.isAdmin;
  const canEdit = scope.canManage;
  const { id } = await params;
  const sp = await searchParams;
  const range = parseRange(sp);
  const repo = parseRepo(sp.repo);
  const chartN = Math.max(MIN_CHART_WEEKS, range.weeks);
  const m = await db.member.findUnique({ where: { id }, include: { team: { select: { name: true } } } });
  // Sin acceso se responde igual que si no existiera, para no revelar quién hay en otros equipos.
  if (!m || !scope.canAccessTeam(m.teamId)) notFound();
  const cfg = await getConfig();

  const [series, prs, openTasks, doneTasks, notes, totalPrs, totalMerged, totalReviews, repos] = await Promise.all([
    weeklySeries(range.end, chartN, id, repo),
    db.pullRequest.findMany({
      where: { memberId: id, ...(repo ? { repo } : {}) },
      orderBy: { createdAtGh: "desc" },
      take: 50,
    }),
    db.zohoTask.findMany({ where: { members: { some: { id } }, completed: false }, orderBy: [{ dueDate: "asc" }], take: 50 }),
    db.zohoTask.findMany({ where: { members: { some: { id } }, completed: true }, orderBy: { completedAt: "desc" }, take: 20 }),
    db.memberNote.findMany({ where: { memberId: id }, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } }),
    db.pullRequest.count({ where: { memberId: id } }),
    db.pullRequest.count({ where: { memberId: id, state: "MERGED" } }),
    db.prReview.count({ where: { memberId: id } }),
    listRepos([id]),
  ]);

  const weeks = series.byMember.get(id) ?? Array.from({ length: chartN }, emptyStats);
  const labels = series.weekStarts.map(shortDate);
  const dim = chartN - range.weeks; // barras previas al periodo elegido
  const inRange = sumStats(weeks.slice(-range.weeks));
  const pendingActions = notes.filter((n) => n.kind === "ACTION" && !n.done);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/team" className="text-xs font-medium text-slate-500 hover:text-slate-800">← Personas</Link>
          </div>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {m.name} {m.archivedAt && <Badge tone="gray">Archivado</Badge>}
          </h1>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
            {m.team && <dd className="font-medium text-slate-700">{m.team.name}</dd>}
            {m.position && <dd>{m.position}</dd>}
            <dd className="break-all">{m.email}</dd>
            <dd>
              {m.githubLogin ? (
                <a className="text-indigo-600 hover:underline" href={`https://github.com/${m.githubLogin}`} target="_blank" rel="noopener noreferrer">
                  @{m.githubLogin}
                </a>
              ) : (
                <span className="text-amber-700">sin usuario de GitHub</span>
              )}
            </dd>
            <dd>Zoho: {m.zohoUserId ? "vinculado" : "sin vincular"}</dd>
            <dd>Desde {formatDate(m.startedAt)}</dd>
          </dl>
          {!m.archivedAt &&
            ((cfg.githubConfigured && m.githubLogin && !m.githubSyncedAt) || (cfg.zohoConfigured && !m.zohoSyncedAt)) && (
              <p className="mt-2 text-sm text-sky-700">
                Su historial aún no se ha traído por completo. Se hará en la próxima sincronización{isAdmin && (
                  <>
                    , o ahora desde <Link href="/settings" className="underline">Integraciones</Link>
                  </>
                )}.
              </p>
            )}
        </div>
        {canEdit &&
          (m.archivedAt ? (
            <form action={restoreMemberAction} className="shrink-0">
              <input type="hidden" name="id" value={m.id} />
              <SubmitButton className="btn-ghost w-full sm:w-auto">Restaurar</SubmitButton>
            </form>
          ) : (
            <form action={archiveMemberAction} className="shrink-0">
              <input type="hidden" name="id" value={m.id} />
              <SubmitButton className="btn-danger w-full sm:w-auto" confirm={`¿Archivar a ${m.name}? Su historial se conserva y puedes restaurarlo.`}>
                Archivar
              </SubmitButton>
            </form>
          ))}
      </div>

      <RangeNav base={`/team/${m.id}`} range={range} repos={repos} repo={repo} />
      {repo && (
        <Notice>
          Viendo solo el repositorio <strong className="break-all">{repo}</strong> (las tareas de Zoho no se filtran por repositorio y no se muestran en las tarjetas ni gráficas).
        </Notice>
      )}

      <div className={STAT_GRID_5}>
        <Stat label="PRs creados" value={inRange.prsOpened} />
        <Stat label="PRs mergeados" value={inRange.prsMerged} />
        <Stat label="PRs abiertos al cierre" value={inRange.openAtEnd} />
        <Stat label="Reviews" value={inRange.reviews} />
        {!repo && <Stat label="Tareas Zoho completadas" value={inRange.tasksCompleted} />}
      </div>
      <p className="-mt-3 text-xs text-slate-500">
        Histórico sincronizado: {totalPrs} PRs ({totalMerged} mergeados) · {totalReviews} reviews.
      </p>

      <ChartRail cols="md:grid-cols-2 xl:grid-cols-3">
        <Card title="PRs creados por semana">
          <Bars values={weeks.map((s) => s.prsOpened)} labels={labels} color="bg-amber-500" dim={dim} />
        </Card>
        <Card title="PRs mergeados por semana">
          <Bars values={weeks.map((s) => s.prsMerged)} labels={labels} dim={dim} />
        </Card>
        <Card title="PRs abiertos al cierre de cada semana">
          <Bars values={weeks.map((s) => s.openAtEnd)} labels={labels} color="bg-sky-500" dim={dim} />
        </Card>
        <Card title="Reviews por semana">
          <Bars values={weeks.map((s) => s.reviews)} labels={labels} color="bg-rose-400" dim={dim} />
        </Card>
        {!repo && (
          <Card title="Tareas Zoho completadas por semana">
            <Bars values={weeks.map((s) => s.tasksCompleted)} labels={labels} color="bg-emerald-500" dim={dim} />
          </Card>
        )}
      </ChartRail>

      <Card title={`Seguimiento${pendingActions.length ? ` · ${pendingActions.length} pendiente(s)` : ""}`}>
        {canEdit && <NoteForm memberId={m.id} />}
        {notes.length === 0 ? (
          <Empty>Sin notas todavía.</Empty>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-3 text-sm">
                {n.kind === "ACTION" ? (
                  <form action={toggleNoteAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button
                      disabled={!canEdit}
                      className={`grid h-7 w-7 place-items-center rounded-md border-2 text-sm font-bold leading-none transition ${
                        n.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white text-transparent hover:border-indigo-400"
                      }`}
                      aria-label={n.done ? "Marcar pendiente" : "Marcar hecho"}
                    >
                      ✓
                    </button>
                  </form>
                ) : (
                  <span className="grid h-7 w-7 place-items-center text-slate-400">•</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className={`whitespace-pre-wrap break-words ${n.done ? "text-slate-400 line-through" : ""}`}>{n.body}</p>
                  <p className="text-xs text-slate-500">
                    {n.author?.name ?? "—"} · {formatDate(n.createdAt)}
                    {n.dueDate && ` · límite ${formatDate(n.dueDate)}`}
                    {n.dueDate && !n.done && n.dueDate < new Date() && <span className="ml-1 text-red-600">vencido</span>}
                  </p>
                </div>
                {canEdit && (
                  <form action={deleteNoteAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <SubmitButton className="rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600" confirm="¿Borrar esta nota?">
                      Borrar
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Tareas abiertas en Zoho">
          {openTasks.length === 0 ? (
            <Empty>Sin tareas abiertas sincronizadas.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {openTasks.map((t) => (
                <li key={t.id} className="py-2">
                  {t.url ? (
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 hover:underline">{t.name}</a>
                  ) : (
                    <span className="font-medium">{t.name}</span>
                  )}
                  <div className="text-xs text-slate-500">
                    {t.projectName} · {t.status}
                    {t.dueDate && ` · vence ${formatDate(t.dueDate)}`}
                    {t.dueDate && t.dueDate < new Date() && <span className="ml-1 text-red-600">vencida</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Completadas recientemente">
          {doneTasks.length === 0 ? (
            <Empty>Sin tareas completadas.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {doneTasks.map((t) => (
                <li key={t.id} className="py-2">
                  <span className="font-medium">{t.name}</span>
                  <div className="text-xs text-slate-500">
                    {t.projectName} · {t.completedAt ? relativeDays(t.completedAt) : "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Historial de PRs (últimos 50)">
        {prs.length === 0 ? (
          <Empty>Sin PRs sincronizados.</Empty>
        ) : (
          <div className="scroll-x -mx-4 sm:-mx-5">
            <table className="rtable w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {["PR", "Estado", "Creado", "Merge", "Cambios", "Review"].map((h) => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 max-sm:mx-4 max-sm:block">
                {prs.map((p) => (
                  <tr key={p.id}>
                    <td className="td" data-primary>
                      <div className="min-w-0">
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-indigo-700 hover:underline">
                          {p.repo}#{p.number}
                        </a>
                        <div className="max-w-md truncate text-xs font-normal text-slate-500 max-sm:max-w-none max-sm:whitespace-normal">{p.title}</div>
                      </div>
                    </td>
                    <td className="td" data-label="Estado">{prBadge(p.state, p.isDraft)}</td>
                    <td className="td whitespace-nowrap" data-label="Creado">{formatDate(p.createdAtGh)}</td>
                    <td className="td whitespace-nowrap" data-label="Merge">{formatDate(p.mergedAt)}</td>
                    <td className="td text-xs" data-label="Cambios" data-wide>
                      <span><span className="text-emerald-700">+{p.additions}</span> / <span className="text-red-700">−{p.deletions}</span> · {p.changedFiles} arch.</span>
                    </td>
                    <td className="td text-xs" data-label="1.er review">{p.firstReviewAt ? relativeDays(p.firstReviewAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canEdit && (
        <details className="group rounded-xl border border-slate-200 bg-white shadow-xs">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-slate-800 sm:px-5 [&::-webkit-details-marker]:hidden">
            Editar datos
            <Icon name="chevron" className="ml-auto h-4 w-4 text-slate-400 transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-slate-100 p-4 sm:p-5">
            <MemberForm member={m} teams={scope.teams} allowNoTeam={isAdmin} />
          </div>
        </details>
      )}
      {isAdmin && m.archivedAt && (
        <Card title="Zona de peligro">
          <DeleteMemberForm id={m.id} email={m.email} />
        </Card>
      )}
    </>
  );
}
