import { db } from "./db";
import { WEEK_MS, addWeeks } from "./weeks";

export type WeekStats = {
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  additions: number;
  deletions: number;
  tasksCompleted: number;
  tasksTouched: number;
  mergeHoursTotal: number; // suma, para promediar
};

export const emptyStats = (): WeekStats => ({
  prsOpened: 0,
  prsMerged: 0,
  reviews: 0,
  additions: 0,
  deletions: 0,
  tasksCompleted: 0,
  tasksTouched: 0,
  mergeHoursTotal: 0,
});

export const avgMergeHours = (s: WeekStats) => (s.prsMerged ? s.mergeHoursTotal / s.prsMerged : null);

export const isIdle = (s: WeekStats) =>
  !s.prsOpened && !s.prsMerged && !s.reviews && !s.tasksCompleted && !s.tasksTouched;

export type Series = { weekStarts: Date[]; byMember: Map<string, WeekStats[]>; team: WeekStats[] };

/**
 * Estadísticas semanales de `weeks` semanas que terminan en la semana `lastWeekStart`.
 * Una sola consulta por tabla; el reparto en semanas se hace en memoria.
 */
export async function weeklySeries(lastWeekStart: Date, weeks: number, memberId?: string): Promise<Series> {
  const first = addWeeks(lastWeekStart, -(weeks - 1));
  const end = addWeeks(lastWeekStart, 1);
  const weekStarts = Array.from({ length: weeks }, (_, i) => addWeeks(first, i));
  const range = { gte: first, lt: end };
  const who = memberId ? { memberId } : { memberId: { not: null } };

  const [opened, merged, reviews, completed, touched] = await Promise.all([
    db.pullRequest.findMany({ where: { ...who, createdAtGh: range }, select: { memberId: true, createdAtGh: true } }),
    db.pullRequest.findMany({
      where: { ...who, mergedAt: range },
      select: { memberId: true, mergedAt: true, createdAtGh: true, additions: true, deletions: true },
    }),
    db.prReview.findMany({ where: { ...who, submittedAt: range }, select: { memberId: true, submittedAt: true } }),
    db.zohoTask.findMany({
      where: { completedAt: range, members: memberId ? { some: { id: memberId } } : { some: {} } },
      select: { completedAt: true, members: { select: { id: true } } },
    }),
    db.zohoTask.findMany({
      where: { updatedAtZ: range, members: memberId ? { some: { id: memberId } } : { some: {} } },
      select: { updatedAtZ: true, members: { select: { id: true } } },
    }),
  ]);

  const byMember = new Map<string, WeekStats[]>();
  const team = Array.from({ length: weeks }, emptyStats);
  const idx = (d: Date) => Math.floor((d.getTime() - first.getTime()) / WEEK_MS);
  const slot = (mid: string, i: number) => {
    let arr = byMember.get(mid);
    if (!arr) byMember.set(mid, (arr = Array.from({ length: weeks }, emptyStats)));
    return arr[i]!;
  };
  const bump = (mids: string[], d: Date | null, f: (s: WeekStats) => void) => {
    if (!d) return;
    const i = idx(d);
    if (i < 0 || i >= weeks) return;
    f(team[i]!);
    for (const mid of mids) f(slot(mid, i));
  };

  for (const p of opened) bump([p.memberId!], p.createdAtGh, (s) => s.prsOpened++);
  for (const p of merged)
    bump([p.memberId!], p.mergedAt, (s) => {
      s.prsMerged++;
      s.additions += p.additions;
      s.deletions += p.deletions;
      s.mergeHoursTotal += (p.mergedAt!.getTime() - p.createdAtGh.getTime()) / 3_600_000;
    });
  for (const r of reviews) bump([r.memberId!], r.submittedAt, (s) => s.reviews++);
  for (const t of completed)
    bump(
      t.members.map((m) => m.id),
      t.completedAt,
      (s) => s.tasksCompleted++,
    );
  for (const t of touched)
    bump(
      t.members.map((m) => m.id),
      t.updatedAtZ,
      (s) => s.tasksTouched++,
    );

  return { weekStarts, byMember, team };
}
