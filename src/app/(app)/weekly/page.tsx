import { db } from "@/lib/db";
import { getScope } from "@/lib/access";
import { addWeeks, formatDate, parseRange } from "@/lib/weeks";
import { listRepos, parseRepo } from "@/lib/filters";
import { Badge, Card, Empty, Notice, PageHeader, RangeNav, prBadge } from "@/components/ui";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { ListFilter } from "@/components/list-filter";

export const dynamic = "force-dynamic";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; week?: string; repo?: string }>;
}) {
  const scope = await getScope();
  const ids = await scope.memberIds();
  const sp = await searchParams;
  const weekRange = parseRange(sp);
  const repo = parseRepo(sp.repo);
  const multi = weekRange.weeks > 1;
  const range = { gte: weekRange.start, lt: addWeeks(weekRange.end, 1) };

  const [members, repos] = await Promise.all([
    db.member.findMany({
      where: { AND: [scope.where, { archivedAt: null }] },
      orderBy: { name: "asc" },
      include: {
        pullRequests: {
          where: { ...(repo ? { repo } : {}), OR: [{ createdAtGh: range }, { mergedAt: range }] },
          orderBy: { createdAtGh: "asc" },
        },
        reviews: {
          where: { submittedAt: range, ...(repo ? { pullRequest: { repo } } : {}) },
          include: { pullRequest: { select: { repo: true, number: true, url: true, title: true } } },
        },
        // Las tareas de Zoho no pertenecen a un repositorio: con filtro de repositorio no se listan.
        zohoTasks: {
          where: repo ? { id: "__ninguna__" } : { OR: [{ completedAt: range }, { updatedAtZ: range }] },
          orderBy: { updatedAtZ: "desc" },
        },
      },
    }),
    listRepos(ids),
  ]);

  return (
    <>
      <PageHeader title="Detalle semanal" description="Qué hizo cada persona: PRs, reviews y tareas del periodo." />
      <RangeNav base="/weekly" range={weekRange} repos={repos} repo={repo} />
      {repo && (
        <Notice>
          Viendo solo el repositorio <strong className="break-all">{repo}</strong>. Las tareas de Zoho no se filtran por repositorio y no se listan.
        </Notice>
      )}

      {members.length === 0 && (
        <Card>
          <Empty>No hay compañeros activos.</Empty>
        </Card>
      )}

      {members.length > 0 && (
      <ListFilter placeholder="Buscar persona…" noun="personas" className="space-y-4">
      {members.map((m, idx) => {
        const empty = !m.pullRequests.length && !m.reviews.length && !m.zohoTasks.length;
        // Cada persona es un acordeón: con muchas personas solo se abren las primeras y el resto se explora tocando.
        return (
          <details key={m.id} data-search={m.name} open={members.length <= 4 || idx < 2 || undefined} className="group min-w-0 rounded-xl border border-slate-200 bg-white shadow-xs">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2 sm:px-5 [&::-webkit-details-marker]:hidden">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700" aria-hidden>
                {m.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">{m.name}</span>
                <span className={`block text-xs ${empty ? "text-amber-700" : "text-slate-500"}`}>
                  {empty ? "Sin actividad" : `${m.pullRequests.length} PRs · ${m.reviews.length} reviews · ${m.zohoTasks.length} tareas`}
                </span>
              </span>
              <Icon name="chevron" className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-slate-100 p-4 sm:p-5">
            {empty ? (
              <p className="text-sm text-amber-700">Sin actividad registrada en {multi ? "este periodo" : "esta semana"}.</p>
            ) : (
              <div className="grid gap-5 text-sm md:grid-cols-3 md:gap-6">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Pull requests</h3>
                  {m.pullRequests.length === 0 ? (
                    <p className="text-slate-400">—</p>
                  ) : (
                    <ul className="space-y-2">
                      {m.pullRequests.map((p) => (
                        <li key={p.id}>
                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-indigo-700 hover:underline">
                            {p.repo}#{p.number}
                          </a>{" "}
                          {prBadge(p.state, p.isDraft)}
                          <div className="line-clamp-2 text-xs text-slate-500">
                            {multi && `${formatDate(p.createdAtGh)} · `}
                            {p.title}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Reviews</h3>
                  {m.reviews.length === 0 ? (
                    <p className="text-slate-400">—</p>
                  ) : (
                    <ul className="space-y-2">
                      {m.reviews.map((r) => (
                        <li key={r.id}>
                          <a href={r.pullRequest.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-indigo-700 hover:underline">
                            {r.pullRequest.repo}#{r.pullRequest.number}
                          </a>{" "}
                          <Badge tone={r.state === "APPROVED" ? "green" : r.state === "CHANGES_REQUESTED" ? "red" : "gray"}>{r.state.toLowerCase().replace("_", " ")}</Badge>
                          <div className="line-clamp-2 text-xs text-slate-500">
                            {multi && `${formatDate(r.submittedAt)} · `}
                            {r.pullRequest.title}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Tareas Zoho</h3>
                  {m.zohoTasks.length === 0 ? (
                    <p className="text-slate-400">—</p>
                  ) : (
                    <ul className="space-y-2">
                      {m.zohoTasks.map((t) => (
                        <li key={t.id}>
                          <span className="font-medium">{t.name}</span>{" "}
                          {t.completed ? <Badge tone="green">completada</Badge> : <Badge tone="blue">{t.status}</Badge>}
                          <div className="text-xs text-slate-500">
                            {t.projectName} · act. {formatDate(t.updatedAtZ)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            <Link href={`/team/${m.id}`} className="mt-4 inline-flex min-h-9 items-center text-sm font-medium text-indigo-600 hover:underline">
              Ver perfil completo →
            </Link>
            </div>
          </details>
        );
      })}
      </ListFilter>
      )}
    </>
  );
}
