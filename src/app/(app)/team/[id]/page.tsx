import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { emptyStats, sumStats, weeklySeries } from "@/lib/stats";
import { formatDate, parseRange, relativeDays, shortDate } from "@/lib/weeks";
import { Badge, Bars, Card, Empty, RangeNav, Stat, prBadge } from "@/components/ui";
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
  searchParams: Promise<{ from?: string; to?: string; week?: string }>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const { id } = await params;
  const range = parseRange(await searchParams);
  const chartN = Math.max(MIN_CHART_WEEKS, range.weeks);
  const m = await db.member.findUnique({ where: { id } });
  if (!m) notFound();

  const [series, prs, openTasks, doneTasks, notes, totalPrs, totalMerged, totalReviews] = await Promise.all([
    weeklySeries(range.end, chartN, id),
    db.pullRequest.findMany({ where: { memberId: id }, orderBy: { createdAtGh: "desc" }, take: 50 }),
    db.zohoTask.findMany({ where: { members: { some: { id } }, completed: false }, orderBy: [{ dueDate: "asc" }], take: 50 }),
    db.zohoTask.findMany({ where: { members: { some: { id } }, completed: true }, orderBy: { completedAt: "desc" }, take: 20 }),
    db.memberNote.findMany({ where: { memberId: id }, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } }),
    db.pullRequest.count({ where: { memberId: id } }),
    db.pullRequest.count({ where: { memberId: id, state: "MERGED" } }),
    db.prReview.count({ where: { memberId: id } }),
  ]);

  const weeks = series.byMember.get(id) ?? Array.from({ length: chartN }, emptyStats);
  const labels = series.weekStarts.map(shortDate);
  const dim = chartN - range.weeks; // barras previas al periodo elegido
  const inRange = sumStats(weeks.slice(-range.weeks));
  const pendingActions = notes.filter((n) => n.kind === "ACTION" && !n.done);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {m.name} {m.archivedAt && <Badge tone="gray">Archivado</Badge>}
          </h1>
          <p className="text-sm text-slate-500">
            {m.position ? `${m.position} · ` : ""}
            {m.email} ·{" "}
            {m.githubLogin ? (
              <a className="text-indigo-600 hover:underline" href={`https://github.com/${m.githubLogin}`} target="_blank" rel="noopener noreferrer">
                @{m.githubLogin}
              </a>
            ) : (
              <span className="text-amber-700">sin usuario de GitHub</span>
            )}{" "}
            · Zoho: {m.zohoUserId ? "vinculado" : "sin vincular"} · desde {formatDate(m.startedAt)}
          </p>
          {!m.archivedAt &&
            ((env.githubConfigured && m.githubLogin && !m.githubSyncedAt) || (env.zohoConfigured && !m.zohoSyncedAt)) && (
              <p className="mt-1 text-sm text-sky-700">
                Su historial aún no se ha traído por completo. Se hará en la próxima sincronización, o ahora desde{" "}
                <Link href="/settings" className="underline">Integraciones</Link>.
              </p>
            )}
        </div>
        {isAdmin &&
          (m.archivedAt ? (
            <form action={restoreMemberAction}>
              <input type="hidden" name="id" value={m.id} />
              <SubmitButton className="btn-ghost">Restaurar</SubmitButton>
            </form>
          ) : (
            <form action={archiveMemberAction}>
              <input type="hidden" name="id" value={m.id} />
              <SubmitButton className="btn-danger" confirm={`¿Archivar a ${m.name}? Su historial se conserva y puedes restaurarlo.`}>
                Archivar
              </SubmitButton>
            </form>
          ))}
      </div>

      <RangeNav base={`/team/${m.id}`} range={range} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="PRs creados" value={inRange.prsOpened} />
        <Stat label="PRs mergeados" value={inRange.prsMerged} />
        <Stat label="Reviews" value={inRange.reviews} />
        <Stat label="Tareas Zoho completadas" value={inRange.tasksCompleted} />
      </div>
      <p className="-mt-3 text-xs text-slate-500">
        Histórico sincronizado: {totalPrs} PRs ({totalMerged} mergeados) · {totalReviews} reviews.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="PRs mergeados por semana">
          <Bars values={weeks.map((s) => s.prsMerged)} labels={labels} dim={dim} />
        </Card>
        <Card title="Reviews por semana">
          <Bars values={weeks.map((s) => s.reviews)} labels={labels} color="bg-sky-500" dim={dim} />
        </Card>
        <Card title="Tareas Zoho completadas por semana">
          <Bars values={weeks.map((s) => s.tasksCompleted)} labels={labels} color="bg-emerald-500" dim={dim} />
        </Card>
      </div>

      <Card title={`Seguimiento${pendingActions.length ? ` · ${pendingActions.length} pendiente(s)` : ""}`}>
        {isAdmin && <NoteForm memberId={m.id} />}
        {notes.length === 0 ? (
          <Empty>Sin notas todavía.</Empty>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-3 text-sm">
                {n.kind === "ACTION" ? (
                  <form action={toggleNoteAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button disabled={!isAdmin} className="mt-0.5 h-5 w-5 rounded border border-slate-400 text-xs leading-none" aria-label={n.done ? "Marcar pendiente" : "Marcar hecho"}>
                      {n.done ? "✓" : ""}
                    </button>
                  </form>
                ) : (
                  <span className="mt-0.5 w-5 text-center text-slate-400">•</span>
                )}
                <div className="flex-1">
                  <p className={`whitespace-pre-wrap ${n.done ? "text-slate-400 line-through" : ""}`}>{n.body}</p>
                  <p className="text-xs text-slate-500">
                    {n.author?.name ?? "—"} · {formatDate(n.createdAt)}
                    {n.dueDate && ` · límite ${formatDate(n.dueDate)}`}
                    {n.dueDate && !n.done && n.dueDate < new Date() && <span className="ml-1 text-red-600">vencido</span>}
                  </p>
                </div>
                {isAdmin && (
                  <form action={deleteNoteAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <SubmitButton className="text-xs text-slate-400 hover:text-red-600" confirm="¿Borrar esta nota?">
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {["PR", "Estado", "Creado", "Merge", "Cambios", "Review"].map((h) => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {prs.map((p) => (
                  <tr key={p.id}>
                    <td className="td">
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 hover:underline">
                        {p.repo}#{p.number}
                      </a>
                      <div className="max-w-md truncate text-xs text-slate-500">{p.title}</div>
                    </td>
                    <td className="td">{prBadge(p.state, p.isDraft)}</td>
                    <td className="td">{formatDate(p.createdAtGh)}</td>
                    <td className="td">{formatDate(p.mergedAt)}</td>
                    <td className="td text-xs">
                      <span className="text-emerald-700">+{p.additions}</span> / <span className="text-red-700">−{p.deletions}</span> · {p.changedFiles} arch.
                    </td>
                    <td className="td text-xs">{p.firstReviewAt ? relativeDays(p.firstReviewAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isAdmin && (
        <Card title="Editar datos">
          <MemberForm member={m} />
        </Card>
      )}
      {isAdmin && m.archivedAt && (
        <Card title="Zona de peligro">
          <DeleteMemberForm id={m.id} email={m.email} />
        </Card>
      )}
    </>
  );
}
