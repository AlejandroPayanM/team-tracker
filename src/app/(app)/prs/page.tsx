import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { avgMergeHours, sumStats, weeklySeries } from "@/lib/stats";
import { listRepos, parseRepo } from "@/lib/filters";
import { addWeeks, formatDate, parseRange, shortDate, weekParam } from "@/lib/weeks";
import { Badge, Bars, Card, Empty, RangeNav, Stat, prBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const MIN_CHART_WEEKS = 8;
const LIST_LIMIT = 100;

const fmtHours = (h: number | null) => (h === null ? "—" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);

export default async function PrsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; week?: string; repo?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const range = parseRange(sp);
  const repo = parseRepo(sp.repo);
  const { weeks } = range;
  const chartN = Math.max(MIN_CHART_WEEKS, weeks);
  const total = Math.max(chartN, weeks * 2);

  const inRange = { gte: range.start, lt: addWeeks(range.end, 1) };
  const team = { memberId: { not: null } };
  const inRepo = repo ? { repo } : {};
  const touched = { OR: [{ createdAtGh: inRange }, { mergedAt: inRange }] };

  const [series, repos, rangePrs, openNowByRepo, stateCounts, list, listTotal] = await Promise.all([
    weeklySeries(range.end, total, undefined, repo),
    listRepos(),
    // Base de la tabla por repositorio (siempre sobre todos los repositorios).
    db.pullRequest.findMany({
      where: { ...team, ...touched },
      select: { repo: true, memberId: true, createdAtGh: true, mergedAt: true },
    }),
    db.pullRequest.groupBy({ by: ["repo"], where: { ...team, state: "OPEN" }, _count: { _all: true } }),
    db.pullRequest.groupBy({ by: ["state"], where: { ...team, ...inRepo, createdAtGh: inRange }, _count: { _all: true } }),
    db.pullRequest.findMany({
      where: { ...team, ...inRepo, ...touched },
      orderBy: { createdAtGh: "desc" },
      take: LIST_LIMIT,
      include: { member: { select: { id: true, name: true } } },
    }),
    db.pullRequest.count({ where: { ...team, ...inRepo, ...touched } }),
  ]);

  const cur = sumStats(series.team.slice(-weeks));
  const prev = sumStats(series.team.slice(-2 * weeks, -weeks));
  const chartWeeks = series.team.slice(-chartN);
  const labels = series.weekStarts.slice(-chartN).map(shortDate);
  const dim = chartN - weeks;

  const openNow = openNowByRepo
    .filter((r) => !repo || r.repo === repo)
    .reduce((a, r) => a + r._count._all, 0);

  // Composición de los PRs creados en el periodo, según su estado actual.
  const byState = { MERGED: 0, OPEN: 0, CLOSED: 0 };
  for (const s of stateCounts) if (s.state in byState) byState[s.state as keyof typeof byState] = s._count._all;
  const createdTotal = byState.MERGED + byState.OPEN + byState.CLOSED;
  const pct = (n: number) => (createdTotal ? Math.round((n / createdTotal) * 100) : 0);

  // Tabla por repositorio.
  type Row = { repo: string; created: number; merged: number; mergeHours: number; people: Set<string>; open: number };
  const rows = new Map<string, Row>();
  const row = (r: string): Row => {
    let x = rows.get(r);
    if (!x) rows.set(r, (x = { repo: r, created: 0, merged: 0, mergeHours: 0, people: new Set(), open: 0 }));
    return x;
  };
  for (const p of rangePrs) {
    const x = row(p.repo);
    if (p.createdAtGh >= inRange.gte && p.createdAtGh < inRange.lt) {
      x.created++;
      x.people.add(p.memberId!);
    }
    if (p.mergedAt && p.mergedAt >= inRange.gte && p.mergedAt < inRange.lt) {
      x.merged++;
      x.mergeHours += (p.mergedAt.getTime() - p.createdAtGh.getTime()) / 3_600_000;
      x.people.add(p.memberId!);
    }
  }
  for (const o of openNowByRepo) row(o.repo).open = o._count._all;
  const repoRows = [...rows.values()].sort((a, b) => b.created + b.merged - (a.created + a.merged) || a.repo.localeCompare(b.repo));
  const maxCreated = Math.max(1, ...repoRows.map((r) => r.created));

  const qs = (r?: string) => `?from=${weekParam(range.start)}&to=${weekParam(range.end)}${r ? `&repo=${encodeURIComponent(r)}` : ""}`;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pull requests</h1>
          <p className="text-sm text-slate-500">Vista general del equipo, por repositorio o todos juntos.</p>
        </div>
        <RangeNav base="/prs" range={range} repos={repos} repo={repo} />
      </div>

      {repo && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-900">
          Viendo solo el repositorio <strong>{repo}</strong>.{" "}
          <Link href={`/prs${qs()}`} className="font-medium underline">
            Ver todos los repositorios
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat label="PRs creados" value={cur.prsOpened} prev={prev.prsOpened} />
        <Stat label="PRs mergeados" value={cur.prsMerged} prev={prev.prsMerged} />
        <Stat label="Cerrados sin merge" value={cur.prsClosed} prev={prev.prsClosed} />
        <Stat label="Abiertos ahora" value={openNow} />
        <Stat label="Prom. creación → merge" value={fmtHours(avgMergeHours(cur))} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="PRs creados por semana">
          <Bars values={chartWeeks.map((s) => s.prsOpened)} labels={labels} color="bg-amber-500" dim={dim} />
        </Card>
        <Card title="PRs mergeados por semana">
          <Bars values={chartWeeks.map((s) => s.prsMerged)} labels={labels} dim={dim} />
        </Card>
        <Card title="PRs abiertos al cierre de cada semana">
          <Bars values={chartWeeks.map((s) => s.openAtEnd)} labels={labels} color="bg-sky-500" dim={dim} />
        </Card>
        <Card title={`Estado actual de los ${createdTotal} PRs creados en el periodo`}>
          {createdTotal === 0 ? (
            <Empty>Sin PRs creados en este periodo.</Empty>
          ) : (
            <div className="space-y-3">
              <div className="flex h-5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Mergeados ${byState.MERGED}, abiertos ${byState.OPEN}, cerrados sin merge ${byState.CLOSED}`}>
                <div className="bg-violet-500" style={{ width: `${(byState.MERGED / createdTotal) * 100}%` }} title={`Mergeados: ${byState.MERGED}`} />
                <div className="bg-emerald-500" style={{ width: `${(byState.OPEN / createdTotal) * 100}%` }} title={`Abiertos: ${byState.OPEN}`} />
                <div className="bg-red-400" style={{ width: `${(byState.CLOSED / createdTotal) * 100}%` }} title={`Cerrados sin merge: ${byState.CLOSED}`} />
              </div>
              <ul className="space-y-1 text-sm">
                <li><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-violet-500" />Mergeados: <strong>{byState.MERGED}</strong> ({pct(byState.MERGED)}%)</li>
                <li><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />Abiertos: <strong>{byState.OPEN}</strong> ({pct(byState.OPEN)}%)</li>
                <li><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-red-400" />Cerrados sin merge: <strong>{byState.CLOSED}</strong> ({pct(byState.CLOSED)}%)</li>
              </ul>
            </div>
          )}
        </Card>
      </div>

      {!repo && (
        <Card title="Por repositorio">
          {repoRows.length === 0 ? (
            <Empty>Sin actividad de PRs en este periodo.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    {["Repositorio", "Creados", "", "Mergeados", "Abiertos ahora", "Prom. a merge", "Personas"].map((h, i) => (
                      <th key={i} className="th">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {repoRows.map((r) => (
                    <tr key={r.repo} className="hover:bg-slate-50">
                      <td className="td font-medium">
                        <Link className="text-indigo-700 hover:underline" href={`/prs${qs(r.repo)}`}>{r.repo}</Link>
                      </td>
                      <td className="td">{r.created}</td>
                      <td className="td w-40">
                        <div className="h-2 rounded bg-amber-400" style={{ width: `${(r.created / maxCreated) * 100}%`, minWidth: r.created ? 4 : 0 }} />
                      </td>
                      <td className="td">{r.merged}</td>
                      <td className="td">{r.open}</td>
                      <td className="td">{fmtHours(r.merged ? r.mergeHours / r.merged : null)}</td>
                      <td className="td">{r.people.size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card
        title={`Detalle de PRs${repo ? ` · ${repo}` : ""}`}
        action={<span className="text-xs text-slate-500">{listTotal > LIST_LIMIT ? `Mostrando los ${LIST_LIMIT} más recientes de ${listTotal}` : `${listTotal} en el periodo`}</span>}
      >
        {list.length === 0 ? (
          <Empty>Sin PRs creados o mergeados en este periodo.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {["PR", "Autor", "Estado", "Creado", "Merge", "Cambios"].map((h) => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="td">
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 hover:underline">
                        {p.repo}#{p.number}
                      </a>
                      <div className="max-w-md truncate text-xs text-slate-500">{p.title}</div>
                    </td>
                    <td className="td">
                      {p.member ? <Link className="text-indigo-700 hover:underline" href={`/team/${p.member.id}`}>{p.member.name}</Link> : "—"}
                    </td>
                    <td className="td">{prBadge(p.state, p.isDraft)}</td>
                    <td className="td">{formatDate(p.createdAtGh)}</td>
                    <td className="td">{formatDate(p.mergedAt)}</td>
                    <td className="td text-xs">
                      <span className="text-emerald-700">+{p.additions}</span> / <span className="text-red-700">−{p.deletions}</span> · {p.changedFiles} arch.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">
        Solo cuentan los PRs creados por personas del equipo que ya están sincronizados. <Badge tone="gray">Draft</Badge> y abiertos se incluyen en «Abiertos ahora».
      </p>
    </>
  );
}
