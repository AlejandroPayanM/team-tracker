import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { avgMergeHours, isIdle, sumStats, weeklySeries } from "@/lib/stats";
import { countPendingBackfill } from "@/lib/sync";
import { parseRange, relativeDays, shortDate } from "@/lib/weeks";
import { Badge, Bars, Card, Empty, RangeNav, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const STALE_DAYS = 3;
const MIN_CHART_WEEKS = 8;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; week?: string }>;
}) {
  await requireUser();
  const range = parseRange(await searchParams);
  const { weeks } = range;
  const chartN = Math.max(MIN_CHART_WEEKS, weeks); // la gráfica da contexto si el rango es corto
  const total = Math.max(chartN, weeks * 2); // + el periodo previo, para comparar

  const pendingBackfill = await countPendingBackfill();
  const [series, members, openPrs, lastRuns] = await Promise.all([
    weeklySeries(range.end, total),
    db.member.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
    db.pullRequest.findMany({
      where: { state: "OPEN", isDraft: false, memberId: { not: null }, member: { archivedAt: null } },
      include: { member: { select: { id: true, name: true } } },
      orderBy: { createdAtGh: "asc" },
    }),
    db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
  ]);

  const cur = sumStats(series.team.slice(-weeks));
  const prev = sumStats(series.team.slice(-2 * weeks, -weeks));
  const chartWeeks = series.team.slice(-chartN);
  const labels = series.weekStarts.slice(-chartN).map(shortDate);
  const dim = chartN - weeks; // barras previas al periodo elegido
  const openByMember = new Map<string, number>();
  for (const p of openPrs) openByMember.set(p.memberId!, (openByMember.get(p.memberId!) ?? 0) + 1);
  const stale = openPrs.filter((p) => !p.firstReviewAt && Date.now() - p.createdAtGh.getTime() > STALE_DAYS * 86_400_000);

  const lastOk = (src: string) => lastRuns.find((r) => r.source === src && r.status === "OK");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Resumen del equipo</h1>
        <RangeNav base="/" range={range} />
      </div>

      {pendingBackfill > 0 && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {pendingBackfill === 1 ? "1 compañero tiene" : `${pendingBackfill} compañeros tienen`} su historial pendiente de traer, por
          eso quizá falten datos. Se completa en la próxima sincronización o ahora mismo desde{" "}
          <Link href="/settings" className="font-medium underline">Integraciones</Link>.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="PRs abiertos (creados)" value={cur.prsOpened} prev={prev.prsOpened} />
        <Stat label="PRs mergeados" value={cur.prsMerged} prev={prev.prsMerged} />
        <Stat label="Reviews realizados" value={cur.reviews} prev={prev.reviews} />
        <Stat label="Tareas Zoho completadas" value={cur.tasksCompleted} prev={prev.tasksCompleted} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="PRs mergeados por semana">
          <Bars values={chartWeeks.map((s) => s.prsMerged)} labels={labels} dim={dim} />
        </Card>
        <Card title="Tareas Zoho completadas por semana">
          <Bars values={chartWeeks.map((s) => s.tasksCompleted)} labels={labels} color="bg-emerald-500" dim={dim} />
        </Card>
      </div>

      <Card title="Por compañero">
        {members.length === 0 ? (
          <Empty>
            Aún no hay compañeros. <Link className="text-indigo-600 underline" href="/team">Agrega el primero</Link>.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {["Compañero", "PRs creados", "Mergeados", "Reviews", "Líneas +/−", "Prom. a merge", "Tareas Zoho", "PRs abiertos hoy", ""].map(
                    (h) => (
                      <th key={h} className="th">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => {
                  const s = sumStats(series.byMember.get(m.id)?.slice(-weeks) ?? []);
                  const avg = avgMergeHours(s);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="td font-medium">
                        <Link className="text-indigo-700 hover:underline" href={`/team/${m.id}`}>
                          {m.name}
                        </Link>
                        {!m.githubLogin && <div className="text-xs font-normal text-amber-700">sin usuario de GitHub</div>}
                      </td>
                      <td className="td">{s.prsOpened}</td>
                      <td className="td">{s.prsMerged}</td>
                      <td className="td">{s.reviews}</td>
                      <td className="td text-xs">
                        <span className="text-emerald-700">+{s.additions}</span> / <span className="text-red-700">−{s.deletions}</span>
                      </td>
                      <td className="td">{avg === null ? "—" : avg < 48 ? `${avg.toFixed(1)} h` : `${(avg / 24).toFixed(1)} d`}</td>
                      <td className="td">
                        {s.tasksCompleted} <span className="text-xs text-slate-400">/ {s.tasksTouched} tocadas</span>
                      </td>
                      <td className="td">{openByMember.get(m.id) ?? 0}</td>
                      <td className="td">{isIdle(s) && <Badge tone="amber">Sin actividad</Badge>}</td>
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
                <li key={p.id} className="py-2">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 hover:underline">
                    {p.repo}#{p.number}
                  </a>{" "}
                  {p.title}
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
                <li key={src} className="flex items-center justify-between">
                  <span>{src === "GITHUB" ? "GitHub" : "Zoho Projects"}</span>
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
