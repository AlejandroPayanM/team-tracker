import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { WEEK_MS, addWeeks, formatDate, formatDateTime, formatRange, shortDate } from "../weeks";
import { CHART_DIMS, DATE_BY, GROUPS, METRICS, PR_STATES, type ChartDim, type ChartType, type MetricKey, type PrStateKey, type ReportSpec } from "./spec";

export const MAX_DETAIL_ROWS = 5000;

// ───────── Cubo de datos: (persona, repositorio, semana) → cifras ─────────

type Flow = {
  prsOpened: number;
  prsMerged: number;
  prsClosed: number;
  openAtEnd: number;
  reviews: number;
  additions: number;
  deletions: number;
  mergeHours: number;
};
const zeroFlow = (): Flow => ({
  prsOpened: 0,
  prsMerged: 0,
  prsClosed: 0,
  openAtEnd: 0,
  reviews: 0,
  additions: 0,
  deletions: 0,
  mergeHours: 0,
});
type Cell = Flow & { memberId: string; repo: string; w: number };
type TaskEv = { members: string[]; w: number; completed: boolean; touched: boolean };
type ScopeMember = { id: string; name: string; archived: boolean; teamId: string | null; teamName: string | null };

export type Cube = {
  first: Date;
  weeks: number;
  cells: Cell[];
  tasks: TaskEv[];
  /** Las tareas de Zoho no pertenecen a un repositorio: con filtro de repositorio no aplican. */
  zohoApplies: boolean;
  scope: ScopeMember[];
};

/** Personas incluidas en el reporte: el alcance del usuario (equipos) combinado con lo que pidió el reporte. */
async function resolveScope(spec: ReportSpec, memberWhere: Prisma.MemberWhereInput): Promise<ScopeMember[]> {
  const scopeRows = await db.member.findMany({
    where: {
      AND: [
        memberWhere,
        spec.members.length ? { id: { in: spec.members } } : spec.includeArchived ? {} : { archivedAt: null },
      ],
    },
    select: { id: true, name: true, archivedAt: true, team: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return scopeRows.map((m) => ({
    id: m.id,
    name: m.name,
    archived: !!m.archivedAt,
    teamId: m.team?.id ?? null,
    teamName: m.team?.name ?? null,
  }));
}

/**
 * `memberWhere` es el alcance del usuario (equipos). Se combina con AND: aunque el reporte pida a una persona de otro
 * equipo por id, no entra.
 */
export async function loadCube(spec: ReportSpec, memberWhere: Prisma.MemberWhereInput): Promise<Cube> {
  const { range } = spec;
  const first = range.start;
  const weeks = range.weeks;
  const end = addWeeks(range.end, 1);
  const inRange = { gte: first, lt: end };

  const scope = await resolveScope(spec, memberWhere);
  const ids = scope.map((m) => m.id);
  const zohoApplies = spec.repos.length === 0;
  if (!ids.length) return { first, weeks, cells: [], tasks: [], zohoApplies, scope };

  const who = { memberId: { in: ids } };
  const inRepo = spec.repos.length ? { repo: { in: spec.repos } } : {};

  const [opened, merged, closed, stillOpen, reviews, tasks] = await Promise.all([
    db.pullRequest.findMany({
      where: { ...who, ...inRepo, createdAtGh: inRange },
      select: { memberId: true, repo: true, createdAtGh: true, additions: true, deletions: true },
    }),
    db.pullRequest.findMany({
      where: { ...who, ...inRepo, mergedAt: inRange },
      select: { memberId: true, repo: true, mergedAt: true, createdAtGh: true },
    }),
    db.pullRequest.findMany({
      where: { ...who, ...inRepo, state: "CLOSED", closedAt: inRange },
      select: { memberId: true, repo: true, closedAt: true },
    }),
    db.pullRequest.findMany({
      where: { ...who, ...inRepo, createdAtGh: { lt: end }, OR: [{ closedAt: null }, { closedAt: { gte: first } }] },
      select: { memberId: true, repo: true, createdAtGh: true, closedAt: true, mergedAt: true },
    }),
    db.prReview.findMany({
      where: { ...who, submittedAt: inRange, ...(spec.repos.length ? { pullRequest: { repo: { in: spec.repos } } } : {}) },
      select: { memberId: true, submittedAt: true, pullRequest: { select: { repo: true } } },
    }),
    zohoApplies
      ? db.zohoTask.findMany({
          where: {
            members: { some: { id: { in: ids } } },
            OR: [{ completedAt: inRange }, { updatedAtZ: inRange }],
          },
          select: { completedAt: true, updatedAtZ: true, members: { select: { id: true } } },
        })
      : Promise.resolve([]),
  ]);

  const cells = new Map<string, Cell>();
  const cell = (memberId: string, repo: string, w: number): Cell => {
    const key = `${memberId}|${repo}|${w}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { ...zeroFlow(), memberId, repo, w }));
    return c;
  };
  const idx = (d: Date) => Math.floor((d.getTime() - first.getTime()) / WEEK_MS);
  const within = (w: number) => w >= 0 && w < weeks;

  for (const p of opened) {
    const w = idx(p.createdAtGh);
    if (!within(w)) continue;
    // Las líneas se cuentan al crear el PR (una sola vez), estén o no mergeados.
    const c = cell(p.memberId!, p.repo, w);
    c.prsOpened++;
    c.additions += p.additions;
    c.deletions += p.deletions;
  }
  for (const p of merged) {
    const w = idx(p.mergedAt!);
    if (!within(w)) continue;
    const c = cell(p.memberId!, p.repo, w);
    c.prsMerged++;
    c.mergeHours += (p.mergedAt!.getTime() - p.createdAtGh.getTime()) / 3_600_000;
  }
  for (const p of closed) {
    const w = idx(p.closedAt!);
    if (within(w)) cell(p.memberId!, p.repo, w).prsClosed++;
  }
  for (const r of reviews) {
    const w = idx(r.submittedAt);
    if (within(w)) cell(r.memberId!, r.pullRequest.repo, w).reviews++;
  }
  // Saldo de abiertos: ¿seguía abierto cuando terminó cada semana?
  for (const p of stillOpen) {
    const endedAt = p.closedAt ?? p.mergedAt;
    for (let w = 0; w < weeks; w++) {
      const weekEnd = addWeeks(first, w + 1);
      if (p.createdAtGh < weekEnd && (!endedAt || endedAt >= weekEnd)) cell(p.memberId!, p.repo, w).openAtEnd++;
    }
  }

  const taskEvents: TaskEv[] = [];
  const scopeIds = new Set(ids);
  for (const t of tasks) {
    const members = t.members.map((m) => m.id).filter((m) => scopeIds.has(m));
    if (t.completedAt && t.completedAt >= first && t.completedAt < end)
      taskEvents.push({ members, w: idx(t.completedAt), completed: true, touched: false });
    if (t.updatedAtZ && t.updatedAtZ >= first && t.updatedAtZ < end)
      taskEvents.push({ members, w: idx(t.updatedAtZ), completed: false, touched: true });
  }

  return { first, weeks, cells: [...cells.values()], tasks: taskEvents.filter((e) => within(e.w)), zohoApplies, scope };
}

// ───────── Agregación ─────────

export type Metrics = Record<MetricKey, number | null>;
type GroupAcc = { flow: Flow; completed: number; touched: number };

function toMetrics(g: GroupAcc, zoho: boolean): Metrics {
  const f = g.flow;
  return {
    prsOpened: f.prsOpened,
    prsMerged: f.prsMerged,
    prsClosed: f.prsClosed,
    openAtEnd: f.openAtEnd,
    reviews: f.reviews,
    additions: f.additions,
    deletions: f.deletions,
    avgMergeHours: f.prsMerged ? f.mergeHours / f.prsMerged : null,
    tasksCompleted: zoho ? g.completed : null,
    tasksTouched: zoho ? g.touched : null,
  };
}

/**
 * Agrupa el cubo por persona, repositorio, semana o total. `openAtEnd` es un saldo: al agrupar por semana es el de esa
 * semana; en los demás casos es el de la última semana del periodo. Las tareas de Zoho se cuentan una vez por grupo.
 */
export function groupCube(cube: Cube, dim: ChartDim | "total"): Map<string, Metrics> {
  const acc = new Map<string, GroupAcc>();
  const get = (k: string) => {
    let g = acc.get(k);
    if (!g) acc.set(k, (g = { flow: zeroFlow(), completed: 0, touched: 0 }));
    return g;
  };
  const teamOf = new Map(cube.scope.map((m) => [m.id, m.teamId ?? "none"]));
  const key = (c: { memberId: string; repo: string; w: number }) =>
    dim === "person"
      ? c.memberId
      : dim === "repo"
        ? c.repo
        : dim === "team"
          ? (teamOf.get(c.memberId) ?? "none")
          : dim === "week"
            ? String(c.w)
            : "all";

  if (dim === "person") for (const m of cube.scope) get(m.id);
  if (dim === "team") for (const m of cube.scope) get(m.teamId ?? "none");
  if (dim === "week") for (let w = 0; w < cube.weeks; w++) get(String(w));
  if (dim === "total") get("all");

  for (const c of cube.cells) {
    const g = get(key(c));
    g.flow.prsOpened += c.prsOpened;
    g.flow.prsMerged += c.prsMerged;
    g.flow.prsClosed += c.prsClosed;
    g.flow.reviews += c.reviews;
    g.flow.additions += c.additions;
    g.flow.deletions += c.deletions;
    g.flow.mergeHours += c.mergeHours;
    if (dim === "week" || c.w === cube.weeks - 1) g.flow.openAtEnd += c.openAtEnd;
  }

  const zoho = cube.zohoApplies && dim !== "repo";
  if (zoho) {
    for (const ev of cube.tasks) {
      if (!ev.members.length) continue;
      const targets =
        dim === "person"
          ? ev.members
          : dim === "team"
            ? [...new Set(ev.members.map((m) => teamOf.get(m) ?? "none"))] // una vez por equipo
            : [dim === "week" ? String(ev.w) : "all"];
      for (const t of targets) {
        const g = get(t);
        if (ev.completed) g.completed++;
        if (ev.touched) g.touched++;
      }
    }
  }

  const out = new Map<string, Metrics>();
  for (const [k, g] of acc) out.set(k, toMetrics(g, zoho));
  return out;
}

// ───────── Reporte ─────────

export type ColumnKind = "text" | "int" | "hours" | "date" | "link";
export type ReportColumn = { key: string; label: string; kind: ColumnKind; width: number };
export type ReportRow = Record<string, string | number | Date | null>;

export type ChartData = {
  type: Exclude<ChartType, "none">;
  title: string;
  categories: string[];
  values: number[];
  valueLabel: string;
  kind: "int" | "hours";
};

export type Report = {
  title: string;
  subtitle: string[];
  generatedAt: Date;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  kpis: { label: string; value: string }[];
  chart: ChartData | null;
  /** Filas totales disponibles y cuántas se incluyeron (en detalle se limita a MAX_DETAIL_ROWS). */
  totalRows: number;
  truncated: boolean;
  notes: string[];
};

export function formatValue(kind: ColumnKind, v: string | number | Date | null): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return formatDate(v);
  if (typeof v === "number") return kind === "hours" ? `${v.toFixed(1)} h` : v.toLocaleString("es-MX");
  return v;
}

const STATE_LABEL: Record<string, string> = { MERGED: "Mergeado", OPEN: "Abierto", CLOSED: "Cerrado sin merge" };

const PR_STATE_WHERE: Record<PrStateKey, Prisma.PullRequestWhereInput> = {
  OPEN: { state: "OPEN", isDraft: false },
  DRAFT: { state: "OPEN", isDraft: true },
  MERGED: { state: "MERGED" },
  CLOSED: { state: "CLOSED" },
};

/**
 * Listado de PRs: una fila por PR de las personas elegidas (dentro del alcance del usuario), con filtros de estado,
 * fechas, repositorio y texto. Los totales del encabezado cuentan todos los que cumplen los filtros aunque la lista
 * se recorte al máximo permitido.
 */
async function buildPrList(spec: ReportSpec, memberWhere: Prisma.MemberWhereInput): Promise<Report> {
  const scope = await resolveScope(spec, memberWhere);
  const ids = scope.map((m) => m.id);
  const { states, dateBy, q, sort } = spec.prs;
  const inRange = { gte: spec.range.start, lt: addWeeks(spec.range.end, 1) };

  const and: Prisma.PullRequestWhereInput[] = [{ memberId: { in: ids } }];
  if (spec.repos.length) and.push({ repo: { in: spec.repos } });
  if (states.length) and.push({ OR: states.map((s) => PR_STATE_WHERE[s]) });
  if (dateBy === "any") and.push({ OR: [{ createdAtGh: inRange }, { mergedAt: inRange }] });
  else if (dateBy === "created") and.push({ createdAtGh: inRange });
  else if (dateBy === "merged") and.push({ mergedAt: inRange });
  else if (dateBy === "closed") and.push({ state: "CLOSED", closedAt: inRange });
  if (q) {
    const num = /^#?(\d{1,9})$/.exec(q);
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { repo: { contains: q, mode: "insensitive" } },
        ...(num ? [{ number: Number(num[1]) }] : []),
      ],
    });
  }
  const where: Prisma.PullRequestWhereInput = { AND: and };
  const orderBy: Prisma.PullRequestOrderByWithRelationInput[] =
    sort === "created_asc"
      ? [{ createdAtGh: "asc" }, { id: "asc" }]
      : sort === "merged_desc"
        ? [{ mergedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }]
        : sort === "author"
          ? [{ member: { name: "asc" } }, { createdAtGh: "desc" }, { id: "asc" }]
          : sort === "repo"
            ? [{ repo: "asc" }, { number: "desc" }, { id: "asc" }]
            : [{ createdAtGh: "desc" }, { id: "asc" }];

  const [prs, groups] = ids.length
    ? await Promise.all([
        db.pullRequest.findMany({
          where,
          orderBy,
          take: MAX_DETAIL_ROWS,
          include: { member: { select: { name: true, team: { select: { name: true } } } } },
        }),
        db.pullRequest.groupBy({ by: ["state", "isDraft"], where, _count: { _all: true }, _sum: { additions: true, deletions: true } }),
      ])
    : [[], []];

  let count = 0;
  let open = 0;
  let draft = 0;
  let merged = 0;
  let closed = 0;
  let adds = 0;
  let dels = 0;
  for (const g of groups) {
    const n = g._count._all;
    count += n;
    adds += g._sum.additions ?? 0;
    dels += g._sum.deletions ?? 0;
    if (g.state === "MERGED") merged += n;
    else if (g.state === "CLOSED") closed += n;
    else if (g.isDraft) draft += n;
    else open += n;
  }
  const truncated = count > prs.length;
  const notes: string[] = [];
  if (truncated) notes.push(`Se incluyen los ${prs.length.toLocaleString("es-MX")} PRs de ${count.toLocaleString("es-MX")}; acota los filtros para ver el resto.`);

  const columns: ReportColumn[] = [
    { key: "repo", label: "Repositorio", kind: "text", width: 22 },
    { key: "number", label: "PR", kind: "int", width: 8 },
    { key: "title", label: "Título", kind: "text", width: 48 },
    { key: "author", label: "Autor", kind: "text", width: 22 },
    { key: "team", label: "Equipo", kind: "text", width: 18 },
    { key: "state", label: "Estado", kind: "text", width: 16 },
    { key: "createdAt", label: "Creado", kind: "date", width: 13 },
    { key: "mergedAt", label: "Mergeado", kind: "date", width: 13 },
    { key: "closedAt", label: "Cerrado", kind: "date", width: 13 },
    { key: "additions", label: "Líneas +", kind: "int", width: 10 },
    { key: "deletions", label: "Líneas −", kind: "int", width: 10 },
    { key: "changedFiles", label: "Archivos", kind: "int", width: 10 },
    { key: "mergeHours", label: "Horas a merge", kind: "hours", width: 14 },
    { key: "url", label: "Enlace", kind: "link", width: 40 },
  ];
  const rows: ReportRow[] = prs.map((p) => ({
    repo: p.repo,
    number: p.number,
    title: p.title,
    author: p.member?.name ?? p.authorLogin,
    team: p.member?.team?.name ?? null,
    state: p.state === "OPEN" && p.isDraft ? "Borrador" : (STATE_LABEL[p.state] ?? p.state),
    createdAt: p.createdAtGh,
    mergedAt: p.mergedAt,
    closedAt: p.closedAt,
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changedFiles,
    mergeHours: p.mergedAt ? (p.mergedAt.getTime() - p.createdAtGh.getTime()) / 3_600_000 : null,
    url: p.url,
  }));

  const num = (n: number) => n.toLocaleString("es-MX");
  const names = scope.map((m) => m.name);
  const subtitle = [
    `${DATE_BY[dateBy]}${dateBy === "all" ? "" : `: ${formatRange(spec.range.start, spec.range.end)}${spec.range.weeks > 1 ? ` (${spec.range.weeks} semanas)` : ""}`}`,
    `Personas: ${spec.members.length ? names.slice(0, 8).join(", ") + (names.length > 8 ? ` y ${names.length - 8} más` : "") : spec.includeArchived ? "todas (incluye archivadas)" : "todas las activas"}`,
    `Repositorios: ${spec.repos.length ? spec.repos.join(", ") : "todos"}`,
    `Estados: ${states.length ? states.map((s) => PR_STATES[s].toLowerCase()).join(", ") : "todos"}${q ? ` · Texto: «${q}»` : ""}`,
    `Generado: ${formatDateTime(new Date())}`,
  ];

  return {
    title: "Listado de PRs",
    subtitle,
    generatedAt: new Date(),
    columns,
    rows,
    totals: null,
    kpis: [
      { label: "PRs en el listado", value: num(count) },
      { label: "Abiertos", value: num(open) },
      { label: "Borradores", value: num(draft) },
      { label: "Mergeados", value: num(merged) },
      { label: "Cerrados sin merge", value: num(closed) },
      { label: "Líneas agregadas", value: num(adds) },
      { label: "Líneas eliminadas", value: num(dels) },
    ],
    chart: null,
    totalRows: count,
    truncated,
    notes,
  };
}

export async function buildReport(spec: ReportSpec, memberWhere: Prisma.MemberWhereInput): Promise<Report> {
  if (spec.group === "detail") return buildPrList(spec, memberWhere);
  const cube = await loadCube(spec, memberWhere);
  const teamName = new Map<string, string>([["none", "Sin equipo"]]);
  for (const m of cube.scope) if (m.teamId && m.teamName) teamName.set(m.teamId, m.teamName);
  const notes: string[] = [];
  const metricCols: ReportColumn[] = spec.metrics.map((k) => ({
    key: k,
    label: METRICS[k].label,
    kind: METRICS[k].kind,
    width: 16,
  }));
  const total = groupCube(cube, "total").get("all")!;

  const dimLabel: Record<ChartDim, string> = { person: "Persona", repo: "Repositorio", week: "Semana", team: "Equipo" };
  let columns: ReportColumn[] = [];
  let rows: ReportRow[] = [];
  let totals: ReportRow | null = null;
  let totalRows = 0;
  let truncated = false;

  {
    const dim = spec.group as ChartDim;
    const grouped = groupCube(cube, dim);
    columns = [{ key: "group", label: dimLabel[dim], kind: "text", width: 34 }, ...metricCols];
    const make = (label: string, m: Metrics): ReportRow => {
      const row: ReportRow = { group: label };
      for (const k of spec.metrics) row[k] = m[k];
      return row;
    };
    if (dim === "person") {
      rows = cube.scope.map((m) => make(m.archived ? `${m.name} (archivado)` : m.name, grouped.get(m.id)!));
    } else if (dim === "week") {
      rows = Array.from({ length: cube.weeks }, (_, w) =>
        make(formatRange(addWeeks(cube.first, w)), grouped.get(String(w))!),
      );
    } else if (dim === "team") {
      rows = [...grouped.entries()]
        .map(([id, m]) => ({ name: teamName.get(id) ?? id, m }))
        .sort((a, b) => (a.name === "Sin equipo" ? 1 : b.name === "Sin equipo" ? -1 : a.name.localeCompare(b.name)))
        .map(({ name, m }) => make(name, m));
    } else {
      rows = [...grouped.entries()]
        .sort((a, b) => (b[1].prsOpened ?? 0) - (a[1].prsOpened ?? 0) || a[0].localeCompare(b[0]))
        .map(([repo, m]) => make(repo, m));
    }
    totals = make("Total", total);
    totalRows = rows.length;
    if (dim === "repo" && spec.metrics.some((k) => METRICS[k].zoho)) {
      notes.push("Las tareas de Zoho no pertenecen a un repositorio: no se muestran al agrupar por repositorio.");
    }
  }
  if (!cube.zohoApplies && spec.metrics.some((k) => METRICS[k].zoho)) {
    notes.push("Con filtro de repositorio no se incluyen tareas de Zoho.");
  }
  if (spec.metrics.includes("additions") || spec.metrics.includes("deletions")) {
    notes.push("Las líneas suman los PRs creados en el periodo, estén o no mergeados (cada PR cuenta una sola vez).");
  }
  if (spec.metrics.includes("openAtEnd")) {
    notes.push("«PRs abiertos al cierre» es un saldo: al agrupar por semana es el de cada semana; en el resto, el de la última semana del periodo.");
  }

  // KPIs: totales de las métricas elegidas.
  const kpis = spec.metrics
    .filter((k) => total[k] !== null)
    .slice(0, 8)
    .map((k) => ({ label: METRICS[k].label, value: formatValue(METRICS[k].kind, total[k]) }));

  // Gráfica a elección del usuario.
  let chart: ChartData | null = null;
  if (spec.chart.type !== "none") {
    const { by, metric, top, type } = spec.chart;
    if (by === "repo" && METRICS[metric].zoho) {
      notes.push("La gráfica por repositorio no puede mostrar tareas de Zoho; elige otra métrica.");
    } else if (!cube.zohoApplies && METRICS[metric].zoho) {
      notes.push("La gráfica no puede mostrar tareas de Zoho con filtro de repositorio; elige otra métrica.");
    } else {
      const g = groupCube(cube, by);
      let entries: { label: string; value: number }[];
      if (by === "week") {
        entries = Array.from({ length: cube.weeks }, (_, w) => ({
          label: shortDate(addWeeks(cube.first, w)),
          value: g.get(String(w))?.[metric] ?? 0,
        }));
      } else {
        const names = new Map(cube.scope.map((m) => [m.id, m.name]));
        entries = [...g.entries()]
          .map(([k, m]) => ({
            label: by === "person" ? (names.get(k) ?? k) : by === "team" ? (teamName.get(k) ?? k) : k,
            value: m[metric] ?? 0,
          }))
          .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
          .slice(0, top);
      }
      chart = {
        type,
        title: `${METRICS[metric].label} por ${CHART_DIMS[by].toLowerCase()}${by !== "week" && g.size > top ? ` (top ${top})` : ""}`,
        categories: entries.map((e) => e.label),
        values: entries.map((e) => Math.round(e.value * 10) / 10),
        valueLabel: METRICS[metric].label,
        kind: METRICS[metric].kind === "hours" ? "hours" : "int",
      };
    }
  }

  const selected = spec.members.length ? cube.scope.map((m) => m.name) : null;
  const subtitle = [
    `Periodo: ${formatRange(spec.range.start, spec.range.end)}${spec.range.weeks > 1 ? ` (${spec.range.weeks} semanas)` : ""}`,
    `Personas: ${selected ? selected.slice(0, 8).join(", ") + (selected.length > 8 ? ` y ${selected.length - 8} más` : "") : spec.includeArchived ? "todas (incluye archivadas)" : "todas las activas"}`,
    `Repositorios: ${spec.repos.length ? spec.repos.join(", ") : "todos"}`,
    `Generado: ${formatDateTime(new Date())}`,
  ];

  return {
    title: `Reporte de actividad · por ${GROUPS[spec.group].toLowerCase()}`,
    subtitle,
    generatedAt: new Date(),
    columns,
    rows,
    totals,
    kpis,
    chart,
    totalRows,
    truncated,
    notes,
  };
}
