import Link from "next/link";
import { db } from "@/lib/db";
import { getScope } from "@/lib/access";
import { selectTeamAction } from "@/app/actions";
import { avgMergeHours, isIdle, sumStats, weeklySeries } from "@/lib/stats";
import { listRepos, parseRepo } from "@/lib/filters";
import { countPendingBackfill } from "@/lib/sync";
import { parseRange, relativeDays, shortDate, weekParam } from "@/lib/weeks";
import { Badge, Bars, Card, ChartRail, Empty, Notice, PageHeader, RangeNav, STAT_GRID_5, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const STALE_DAYS = 3;
const MIN_CHART_WEEKS = 8;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; week?: string; repo?: string }>;
}) {
  const scope = await getScope();
  const ids = await scope.memberIds();
  const sp = await searchParams;
  const range = parseRange(sp);
  const repo = parseRepo(sp.repo);
  const { weeks } = range;
  const chartN = Math.max(MIN_CHART_WEEKS, weeks); // la gráfica da contexto si el rango es corto
  const total = Math.max(chartN, weeks * 2); // + el periodo previo, para comparar

  const pendingBackfill = await countPendingBackfill(scope.where);
  const [series, members, openPrs, lastRuns, repos] = await Promise.all([
    weeklySeries(range.end, total, undefined, repo, ids),
    db.member.findMany({
      where: { AND: [scope.where, { archivedAt: null }] },
      include: { team: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    db.pullRequest.findMany({
      where: { state: "OPEN", isDraft: false, memberId: { in: ids }, member: { archivedAt: null }, ...(repo ? { repo } : {}) },
      include: { member: { select: { id: true, name: true } } },
      orderBy: { createdAtGh: "asc" },
    }),
    db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    listRepos(ids),
  ]);

  // Vista general (varios equipos a la vez): resumen por equipo.
  const showTeams = scope.selected === "all" && scope.teams.length > 0;
  const teamRows = new Map<string, { id: string; name: string; people: number; opened: number; merged: number; reviews: number; tasks: number }>();
  if (showTeams) {
    for (const m of members) {
      const id = m.team?.id ?? "none";
      const row = teamRows.get(id) ?? { id, name: m.team?.name ?? "Sin equipo", people: 0, opened: 0, merged: 0, reviews: 0, tasks: 0 };
      const s = sumStats(series.byMember.get(m.id)?.slice(-weeks) ?? []);
      row.people++;
      row.opened += s.prsOpened;
      row.merged += s.prsMerged;
      row.reviews += s.reviews;
      row.tasks += s.tasksCompleted;
      teamRows.set(id, row);
    }
  }
  const teamList = [...teamRows.values()].sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : a.name.localeCompare(b.name)));

  const cur = sumStats(series.team.slice(-weeks));
  const prev = sumStats(series.team.slice(-2 * weeks, -weeks));
  const chartWeeks = series.team.slice(-chartN);
  const labels = series.weekStarts.slice(-chartN).map(shortDate);
  const dim = chartN - weeks; // barras previas al periodo elegido
  const openByMember = new Map<string, number>();
  for (const p of openPrs) openByMember.set(p.memberId!, (openByMember.get(p.memberId!) ?? 0) + 1);
  const stale = openPrs.filter((p) => !p.firstReviewAt && Date.now() - p.createdAtGh.getTime() > STALE_DAYS * 86_400_000);

  const lastOk = (src: string) => lastRuns.find((r) => r.source === src && (r.status === "OK" || r.status === "WARNING"));

  return (
    <>
      <PageHeader
        title={scope.teams.length ? `Resumen · ${scope.label}` : "Resumen del equipo"}
        description="Actividad de PRs y tareas en el periodo elegido, comparada con el periodo previo."
      />
      <RangeNav base="/" range={range} repos={repos} repo={repo} />

      {repo && (
        <Notice>
          Viendo solo el repositorio <strong className="break-all">{repo}</strong>. Las tareas de Zoho no pertenecen a un repositorio, por eso no se muestran.{" "}
          <Link href={`/?from=${weekParam(range.start)}&to=${weekParam(range.end)}`} className="font-medium underline">
            Ver todos
          </Link>
        </Notice>
      )}

      {pendingBackfill > 0 && (
        <Notice tone="sky">
          {pendingBackfill === 1 ? "1 compañero tiene" : `${pendingBackfill} compañeros tienen`} su historial pendiente de traer, por
          eso quizá falten datos. Se completa en la próxima sincronización o ahora mismo desde{" "}
          <Link href="/settings" className="font-medium underline">Integraciones</Link>.
        </Notice>
      )}

      <div className={STAT_GRID_5}>
        <Stat label="PRs creados" value={cur.prsOpened} prev={prev.prsOpened} />
        <Stat label="PRs mergeados" value={cur.prsMerged} prev={prev.prsMerged} />
        <Stat label="PRs abiertos al cierre" value={cur.openAtEnd} prev={prev.openAtEnd} />
        <Stat label="Reviews realizados" value={cur.reviews} prev={prev.reviews} />
        {!repo && <Stat label="Tareas Zoho completadas" value={cur.tasksCompleted} prev={prev.tasksCompleted} />}
      </div>

      <ChartRail>
        <Card title="PRs creados por semana">
          <Bars values={chartWeeks.map((s) => s.prsOpened)} labels={labels} color="bg-amber-500" dim={dim} />
        </Card>
        <Card title="PRs mergeados por semana">
          <Bars values={chartWeeks.map((s) => s.prsMerged)} labels={labels} dim={dim} />
        </Card>
        <Card title="PRs abiertos al cierre de cada semana">
          <Bars values={chartWeeks.map((s) => s.openAtEnd)} labels={labels} color="bg-sky-500" dim={dim} />
        </Card>
        {!repo && (
          <Card title="Tareas Zoho completadas por semana">
            <Bars values={chartWeeks.map((s) => s.tasksCompleted)} labels={labels} color="bg-emerald-500" dim={dim} />
          </Card>
        )}
      </ChartRail>

      <p className="-mt-2 hidden text-xs text-slate-500 sm:block">
        Para ver los PRs en conjunto, por repositorio y con su detalle, entra a <Link href="/prs" className="text-indigo-600 hover:underline">Pull requests</Link>.
        «Abiertos al cierre» cuenta los PRs sincronizados que seguían abiertos al terminar cada semana.
      </p>

      {showTeams && teamList.length > 0 && (
        <Card title="Por equipo">
          <div className="scroll-x -mx-4 sm:-mx-5">
            <table className="rtable w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {["Equipo", "Personas", "PRs creados", "Mergeados", "Reviews", "Tareas Zoho", ""].map((h, i) => (
                    <th key={i} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 max-sm:mx-4 max-sm:block">
                {teamList.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="td font-medium" data-primary>{t.name}</td>
                    <td className="td tabular-nums" data-label="Personas">{t.people}</td>
                    <td className="td tabular-nums" data-label="PRs creados">{t.opened}</td>
                    <td className="td tabular-nums" data-label="Mergeados">{t.merged}</td>
                    <td className="td tabular-nums" data-label="Reviews">{t.reviews}</td>
                    <td className="td tabular-nums" data-label="Tareas Zoho">{repo ? "—" : t.tasks}</td>
                    <td className="td" data-empty-label>
                      <form action={selectTeamAction}>
                        <input type="hidden" name="team" value={t.id} />
                        <button type="submit" className="btn-ghost btn-sm">Ver solo este equipo</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Por compañero">
        {members.length === 0 ? (
          <Empty>
            {scope.teams.length === 0 && !scope.isAdmin ? (
              <>Aún no tienes equipos asignados. Pide a un administrador que te asigne uno.</>
            ) : (
              <>
                Aún no hay compañeros{scope.selected !== "all" ? " en este equipo" : ""}.{" "}
                {scope.canManage && <Link className="text-indigo-600 underline" href="/team">Agrega el primero</Link>}
              </>
            )}
          </Empty>
        ) : (
          <div className="scroll-x -mx-4 sm:-mx-5">
            <table className="rtable w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {["Compañero", "PRs creados", "Mergeados", "Reviews", "Líneas +/− (PRs creados)", "Prom. a merge", "Tareas Zoho", "PRs abiertos hoy", ""].map(
                    (h, i) => (
                      <th key={i} className="th">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 max-sm:mx-4 max-sm:block">
                {members.map((m) => {
                  const s = sumStats(series.byMember.get(m.id)?.slice(-weeks) ?? []);
                  const avg = avgMergeHours(s);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="td font-medium" data-primary>
                        <Link className="text-indigo-700 hover:underline" href={`/team/${m.id}`}>
                          {m.name}
                        </Link>
                        {scope.selected === "all" && m.team && <div className="text-xs font-normal text-slate-500">{m.team.name}</div>}
                        {!m.githubLogin && <div className="text-xs font-normal text-amber-700">sin usuario de GitHub</div>}
                      </td>
                      <td className="td tabular-nums" data-label="PRs creados">{s.prsOpened}</td>
                      <td className="td tabular-nums" data-label="Mergeados">{s.prsMerged}</td>
                      <td className="td tabular-nums" data-label="Reviews">{s.reviews}</td>
                      <td className="td text-xs tabular-nums" data-label="Líneas +/−">
                        <span><span className="text-emerald-700">+{s.additions}</span> / <span className="text-red-700">−{s.deletions}</span></span>
                      </td>
                      <td className="td tabular-nums" data-label="Prom. a merge">{avg === null ? "—" : avg < 48 ? `${avg.toFixed(1)} h` : `${(avg / 24).toFixed(1)} d`}</td>
                      <td className="td tabular-nums" data-label="Tareas Zoho">
                        <span>{s.tasksCompleted} <span className="text-xs text-slate-400">/ {s.tasksTouched} tocadas</span></span>
                      </td>
                      <td className="td tabular-nums" data-label="Abiertos hoy">{openByMember.get(m.id) ?? 0}</td>
                      <td className="td" data-empty-label>{isIdle(s) && <Badge tone="amber">Sin actividad</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`PRs abiertos sin review (> ${STALE_DAYS} días)`}>
          {stale.length === 0 ? (
            <Empty>Nada atorado 🎉</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {stale.slice(0, 10).map((p) => (
                <li key={p.id} className="py-2.5">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-indigo-700 hover:underline">
                    {p.repo}#{p.number}
                  </a>{" "}
                  <span className="break-words">{p.title}</span>
                  <div className="text-xs text-slate-500">
                    {p.member?.name} · {relativeDays(p.createdAtGh)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Estado de sincronización">
          <ul className="space-y-2 text-sm">
            {(["GITHUB", "ZOHO"] as const).map((src) => {
              const ok = lastOk(src);
              const last = lastRuns.find((r) => r.source === src);
              return (
                <li key={src} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">{src === "GITHUB" ? "GitHub" : "Zoho Projects"}</span>
                  <span className="text-slate-500">
                    {ok ? `última OK ${relativeDays(ok.startedAt)}` : "nunca sincronizado"}
                    {last && last.status === "ERROR" && <Badge tone="red">último intento con error</Badge>}
                  </span>
                </li>
              );
            })}
          </ul>
          <Link href="/settings" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Configurar / sincronizar →
          </Link>
        </Card>
      </div>
    </>
  );
}
