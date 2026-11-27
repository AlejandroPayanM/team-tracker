import { db } from "./db";
import { WEEK_MS, addWeeks } from "./weeks";

export type WeekStats = {
  prsOpened: number; // PRs creados en la semana
  prsMerged: number;
  prsClosed: number; // cerrados sin merge
  openAtEnd: number; // PRs que seguían abiertos al terminar la semana (no se suma entre semanas)
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
  prsClosed: 0,
  openAtEnd: 0,
  reviews: 0,
  additions: 0,
  deletions: 0,
  tasksCompleted: 0,
  tasksTouched: 0,
  mergeHoursTotal: 0,
});

/** Suma semanas consecutivas (en orden). `openAtEnd` es un saldo, no un flujo: toma el de la última semana. */
export function sumStats(list: WeekStats[]): WeekStats {
  const t = emptyStats();
  for (const s of list) {
    t.prsOpened += s.prsOpened;
    t.prsMerged += s.prsMerged;
    t.prsClosed += s.prsClosed;
    t.reviews += s.reviews;
    t.additions += s.additions;
    t.deletions += s.deletions;
    t.tasksCompleted += s.tasksCompleted;
    t.tasksTouched += s.tasksTouched;
    t.mergeHoursTotal += s.mergeHoursTotal;
  }
  t.openAtEnd = list.at(-1)?.openAtEnd ?? 0;
  return t;
}

export const avgMergeHours = (s: WeekStats) => (s.prsMerged ? s.mergeHoursTotal / s.prsMerged : null);

export const isIdle = (s: WeekStats) =>
  !s.prsOpened && !s.prsMerged && !s.reviews && !s.tasksCompleted && !s.tasksTouched;

export type Series = { weekStarts: Date[]; byMember: Map<string, WeekStats[]>; team: WeekStats[] };

/**
 * Estadísticas semanales de `weeks` semanas que terminan en la semana `lastWeekStart`.
 * Una sola consulta por tabla; el reparto en semanas se hace en memoria.
 * Con `repo` ("owner/nombre") solo cuentan los PRs y reviews de ese repositorio; las tareas de
 * Zoho no pertenecen a un repositorio, así que en ese caso no se incluyen.
 */
export async function weeklySeries(
  lastWeekStart: Date,
  weeks: number,
  memberId?: string,
  repo?: string,
  /** Alcance por equipos: solo cuentan estas personas. Sin esto (y sin memberId) cuenta a todas: úsalo siempre en pantallas. */
  memberIds?: string[],
): Promise<Series> {
  const first = addWeeks(lastWeekStart, -(weeks - 1));
  const end = addWeeks(lastWeekStart, 1);
  const weekStarts = Array.from({ length: weeks }, (_, i) => addWeeks(first, i));
  const range = { gte: first, lt: end };
  const who = memberId ? { memberId } : memberIds ? { memberId: { in: memberIds } } : { memberId: { not: null } };
  const inRepo = repo ? { repo } : {};
  const taskWho = {
    members: memberId ? { some: { id: memberId } } : memberIds ? { some: { id: { in: memberIds } } } : { some: {} },
  };
  type TaskRow = { completedAt: Date | null; updatedAtZ: Date | null; members: { id: string }[] };
  const noTasks = Promise.resolve<TaskRow[]>([]);

  const [opened, merged, closed, stillOpen, reviews, tasks] = await Promise.all([
    db.pullRequest.findMany({
      where: { ...who, ...inRepo, createdAtGh: range },
      select: { memberId: true, createdAtGh: true, additions: true, deletions: true },
    }),
    db.pullRequest.findMany({
      where: { ...who, ...inRepo, mergedAt: range },
      select: { memberId: true, mergedAt: true, createdAtGh: true },
    }),
    db.pullRequest.findMany({
      where: { ...who, ...inRepo, state: "CLOSED", closedAt: range },
      select: { memberId: true, closedAt: true },
    }),
    // Para el saldo de abiertos: creados antes del fin del periodo y no cerrados antes de su inicio.
    db.pullRequest.findMany({
      where: {
        ...who,
        ...inRepo,
        createdAtGh: { lt: end },
        OR: [{ closedAt: null }, { closedAt: { gte: first } }],
      },
      select: { memberId: true, createdAtGh: true, closedAt: true, mergedAt: true },
    }),
    db.prReview.findMany({
      where: { ...who, submittedAt: range, ...(repo ? { pullRequest: { repo } } : {}) },
      select: { memberId: true, submittedAt: true },
    }),
    repo
      ? noTasks
      : db.zohoTask.findMany({
          where: { ...taskWho, OR: [{ completedAt: range }, { updatedAtZ: range }] },
          select: { completedAt: true, updatedAtZ: true, members: { select: { id: true } } },
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

  // Las líneas se cuentan al crear el PR (una sola vez), estén o no mergeados.
  for (const p of opened)
    bump([p.memberId!], p.createdAtGh, (s) => {
      s.prsOpened++;
      s.additions += p.additions;
      s.deletions += p.deletions;
    });
  for (const p of merged)
    bump([p.memberId!], p.mergedAt, (s) => {
      s.prsMerged++;
      s.mergeHoursTotal += (p.mergedAt!.getTime() - p.createdAtGh.getTime()) / 3_600_000;
    });
  for (const p of closed) bump([p.memberId!], p.closedAt, (s) => s.prsClosed++);
  for (const r of reviews) bump([r.memberId!], r.submittedAt, (s) => s.reviews++);
  for (const t of tasks) {
    const ids = t.members.map((m) => m.id);
    if (t.completedAt && t.completedAt >= first && t.completedAt < end) bump(ids, t.completedAt, (s) => s.tasksCompleted++);
    if (t.updatedAtZ && t.updatedAtZ >= first && t.updatedAtZ < end) bump(ids, t.updatedAtZ, (s) => s.tasksTouched++);
  }

  // Saldo: ¿cuántos PRs seguían abiertos al terminar cada semana? (creado antes y sin cerrar/mergear aún)
  for (const p of stillOpen) {
    const endedAt = p.closedAt ?? p.mergedAt;
    for (let i = 0; i < weeks; i++) {
      const weekEnd = addWeeks(first, i + 1);
      if (p.createdAtGh < weekEnd && (!endedAt || endedAt >= weekEnd)) {
        team[i]!.openAtEnd++;
        slot(p.memberId!, i).openAtEnd++;
      }
    }
  }

  return { weekStarts, byMember, team };
}
