import { db } from "@/lib/db";
import { getScope } from "@/lib/access";
import { selectTeamAction } from "@/app/actions";
import { isIdle, sumStats, weeklySeries, type WeekStats } from "@/lib/stats";
import { parseRange } from "@/lib/weeks";
import { Badge, Card, Empty, PageHeader, RangeNav } from "@/components/ui";

export const dynamic = "force-dynamic";

type Totals = { people: number; idle: number; cur: WeekStats; prev: WeekStats };

function Num({ label, cur, prev }: { label: string; cur: number; prev: number }) {
  const d = cur - prev;
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums">{cur}</span>
        {d !== 0 && (
          <span className={`text-xs font-medium ${d > 0 ? "text-emerald-700" : "text-slate-500"}`} title="Contra el periodo previo">
            {d > 0 ? "▲" : "▼"} {Math.abs(d)}
          </span>
        )}
      </div>
    </div>
  );
}

const addInto = (a: WeekStats, b: WeekStats) => {
  a.prsOpened += b.prsOpened;
  a.prsMerged += b.prsMerged;
  a.reviews += b.reviews;
  a.tasksCompleted += b.tasksCompleted;
  a.tasksTouched += b.tasksTouched;
};

export default async function LeadersPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; week?: string }> }) {
  const scope = await getScope();
  const range = parseRange(await searchParams);
  const { weeks } = range;
  const teamIds = scope.teams.map((t) => t.id);

  const [teams, members] = await Promise.all([
    db.team.findMany({
      where: { id: { in: teamIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, leader: { select: { id: true, name: true } } },
    }),
    db.member.findMany({ where: { archivedAt: null, teamId: { in: teamIds } }, select: { id: true, teamId: true } }),
  ]);
  const series = await weeklySeries(range.end, weeks * 2, undefined, undefined, members.map((m) => m.id));

  // Totales por equipo: se suman por persona (una tarea de Zoho puede ser de varias).
  const byTeam = new Map<string, Totals>();
  for (const t of teams) byTeam.set(t.id, { people: 0, idle: 0, cur: sumStats([]), prev: sumStats([]) });
  for (const m of members) {
    const row = byTeam.get(m.teamId!);
    if (!row) continue;
    const weeksOf = series.byMember.get(m.id) ?? [];
    const cur = sumStats(weeksOf.slice(-weeks));
    row.people++;
    if (isIdle(cur)) row.idle++;
    addInto(row.cur, cur);
    addInto(row.prev, sumStats(weeksOf.slice(-2 * weeks, -weeks)));
  }

  // Agrupa por líder; los equipos sin líder designado van al final.
  type Group = { key: string; name: string; mine: boolean; teams: typeof teams };
  const groups = new Map<string, Group>();
  for (const t of teams) {
    const key = t.leader?.id ?? "none";
    const g = groups.get(key) ?? { key, name: t.leader?.name ?? "Sin líder designado", mine: t.leader?.id === scope.user.id, teams: [] };
    g.teams.push(t);
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) =>
    a.key === "none" ? 1 : b.key === "none" ? -1 : a.mine === b.mine ? a.name.localeCompare(b.name) : a.mine ? -1 : 1,
  );

  const sum = (g: Group): Totals => {
    const t: Totals = { people: 0, idle: 0, cur: sumStats([]), prev: sumStats([]) };
    for (const x of g.teams) {
      const r = byTeam.get(x.id)!;
      t.people += r.people;
      t.idle += r.idle;
      addInto(t.cur, r.cur);
      addInto(t.prev, r.prev);
    }
    return t;
  };

  return (
    <>
      <PageHeader title="Líderes" description="Cómo le fue a cada líder con su equipo en el periodo elegido, comparado con el periodo previo." />
      <RangeNav base="/leaders" range={range} />

      {list.length === 0 ? (
        <Card>
          <Empty>Aún no hay equipos. {scope.isAdmin && "Créalos en la sección Equipos y designa a su líder."}</Empty>
        </Card>
      ) : (
        <div className="space-y-5">
          {list.map((g) => {
            const t = sum(g);
            const none = g.key === "none";
            return (
              <section key={g.key} className={`min-w-0 overflow-hidden rounded-xl border bg-white shadow-xs ${none ? "border-dashed border-amber-300" : "border-slate-200"}`}>
                <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full font-semibold ${none ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"}`} aria-hidden>
                    {none ? "?" : g.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="flex flex-wrap items-center gap-2 break-words text-base font-semibold">
                      {g.name}
                      {g.mine && <Badge tone="blue">tú</Badge>}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {g.teams.length} equipo(s) · {t.people} persona(s)
                      {t.idle > 0 && <span className="text-amber-700"> · {t.idle} sin actividad en el periodo</span>}
                    </p>
                  </div>
                  <div className="grid w-full grid-cols-4 gap-3 sm:w-auto sm:gap-6">
                    <Num label="PRs" cur={t.cur.prsOpened} prev={t.prev.prsOpened} />
                    <Num label="Merge" cur={t.cur.prsMerged} prev={t.prev.prsMerged} />
                    <Num label="Reviews" cur={t.cur.reviews} prev={t.prev.reviews} />
                    <Num label="Tareas" cur={t.cur.tasksCompleted} prev={t.prev.tasksCompleted} />
                  </div>
                </header>
                <div className="scroll-x">
                  <table className="rtable w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        {["Equipo", "Personas", "Sin actividad", "PRs creados", "Mergeados", "Reviews", "Tareas Zoho", ""].map((h, i) => (
                          <th key={i} className="th">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 max-sm:mx-4 max-sm:block">
                      {g.teams.map((x) => {
                        const r = byTeam.get(x.id)!;
                        return (
                          <tr key={x.id} className="hover:bg-slate-50">
                            <td className="td font-medium" data-primary>{x.name}</td>
                            <td className="td tabular-nums" data-label="Personas">{r.people}</td>
                            <td className={`td tabular-nums ${r.idle ? "text-amber-700" : ""}`} data-label="Sin actividad">{r.idle}</td>
                            <td className="td tabular-nums" data-label="PRs creados">{r.cur.prsOpened}</td>
                            <td className="td tabular-nums" data-label="Mergeados">{r.cur.prsMerged}</td>
                            <td className="td tabular-nums" data-label="Reviews">{r.cur.reviews}</td>
                            <td className="td tabular-nums" data-label="Tareas Zoho">{r.cur.tasksCompleted}</td>
                            <td className="td" data-empty-label>
                              <form action={selectTeamAction}>
                                <input type="hidden" name="team" value={x.id} />
                                <input type="hidden" name="to" value="/" />
                                <button type="submit" className="btn-ghost btn-sm">Ver equipo</button>
                              </form>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
