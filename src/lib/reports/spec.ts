import { z } from "zod";
import { MAX_RANGE_WEEKS, parseRange, weekParam, type WeekRange } from "../weeks";

// ───────── Catálogo de métricas ─────────

export const METRICS = {
  prsOpened: { label: "PRs creados", kind: "int", zoho: false },
  prsMerged: { label: "PRs mergeados", kind: "int", zoho: false },
  prsClosed: { label: "PRs cerrados sin merge", kind: "int", zoho: false },
  openAtEnd: { label: "PRs abiertos al cierre", kind: "int", zoho: false },
  reviews: { label: "Reviews realizados", kind: "int", zoho: false },
  additions: { label: "Líneas agregadas (PRs creados)", kind: "int", zoho: false },
  deletions: { label: "Líneas eliminadas (PRs creados)", kind: "int", zoho: false },
  avgMergeHours: { label: "Tiempo promedio a merge (h)", kind: "hours", zoho: false },
  tasksCompleted: { label: "Tareas Zoho completadas", kind: "int", zoho: true },
  tasksTouched: { label: "Tareas Zoho con actividad", kind: "int", zoho: true },
} as const;

export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
export const DEFAULT_METRICS: MetricKey[] = [
  "prsOpened",
  "prsMerged",
  "prsClosed",
  "openAtEnd",
  "reviews",
  "additions",
  "deletions",
  "avgMergeHours",
  "tasksCompleted",
];

export const GROUPS = { person: "Persona", team: "Equipo", repo: "Repositorio", week: "Semana", detail: "Detalle de PRs" } as const;
export type GroupBy = keyof typeof GROUPS;

// ───────── Listado de PRs (group = "detail") ─────────

export const PR_STATES = { OPEN: "Abiertos", DRAFT: "Borradores", MERGED: "Mergeados", CLOSED: "Cerrados sin merge" } as const;
export type PrStateKey = keyof typeof PR_STATES;

export const DATE_BY = {
  any: "Creados o mergeados en el periodo",
  created: "Creados en el periodo",
  merged: "Mergeados en el periodo",
  closed: "Cerrados sin merge en el periodo",
  all: "Sin límite de fechas",
} as const;
export type DateBy = keyof typeof DATE_BY;

export const SORTS = {
  created_desc: "Más recientes primero",
  created_asc: "Más antiguos primero",
  merged_desc: "Mergeados más recientes primero",
  author: "Autor (A–Z)",
  repo: "Repositorio (A–Z)",
} as const;
export type SortKey = keyof typeof SORTS;

export const CHART_TYPES = {
  none: "Sin gráfica",
  bar: "Barras verticales",
  hbar: "Barras horizontales",
  line: "Líneas",
  pie: "Circular (dona)",
} as const;
export type ChartType = keyof typeof CHART_TYPES;

export const CHART_DIMS = { person: "Persona", team: "Equipo", repo: "Repositorio", week: "Semana" } as const;
export type ChartDim = keyof typeof CHART_DIMS;

export type ReportSpec = {
  range: WeekRange;
  members: string[]; // ids; vacío = todos (activos, y archivados si includeArchived)
  repos: string[]; // "owner/nombre"; vacío = todos
  includeArchived: boolean;
  group: GroupBy;
  metrics: MetricKey[];
  chart: { type: ChartType; by: ChartDim; metric: MetricKey; top: number };
  /** Solo para el listado de PRs (group = "detail"). */
  prs: { states: PrStateKey[]; dateBy: DateBy; q: string; sort: SortKey };
};

// ───────── Lectura y validación de parámetros (URL o JSON) ─────────

const ID_RE = /^[a-z0-9]{20,40}$/; // cuid
const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

export const DEFAULT_CHART: ReportSpec["chart"] = { type: "bar", by: "week", metric: "prsMerged", top: 10 };

type Raw = Record<string, string | string[] | undefined>;
const arr = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Convierte parámetros de URL en un ReportSpec válido. Lo inválido se ignora y cae al valor por defecto:
 * nunca lanza, y los tamaños están acotados.
 */
export function parseSpec(raw: Raw): ReportSpec {
  const range = parseRange({ from: first(raw.from), to: first(raw.to) });
  const members = [...new Set(arr(raw.members).filter((m) => ID_RE.test(m)))].slice(0, 200);
  const repos = [...new Set(arr(raw.repos).filter((r) => REPO_RE.test(r)))].slice(0, 200);
  const group = z.enum(["person", "team", "repo", "week", "detail"]).catch("person").parse(first(raw.group));

  const metricList = arr(raw.m).filter((k): k is MetricKey => k in METRICS);
  const metrics = metricList.length ? [...new Set(metricList)] : raw.m === undefined ? DEFAULT_METRICS : [];
  const ordered = METRIC_KEYS.filter((k) => metrics.includes(k)); // orden fijo del catálogo

  const type = z.enum(["none", "bar", "hbar", "line", "pie"]).catch(DEFAULT_CHART.type).parse(first(raw.ct));
  const by = z.enum(["person", "team", "repo", "week"]).catch(DEFAULT_CHART.by).parse(first(raw.cb));
  const cm = first(raw.cm);
  const metric = cm && cm in METRICS ? (cm as MetricKey) : DEFAULT_CHART.metric;
  const top = Math.min(25, Math.max(3, Number.parseInt(first(raw.top) ?? "", 10) || DEFAULT_CHART.top));

  const states = [...new Set(arr(raw.st).filter((k): k is PrStateKey => k in PR_STATES))];
  const dateBy = z.enum(["any", "created", "merged", "closed", "all"]).catch("any").parse(first(raw.db));
  const sort = z.enum(["created_desc", "created_asc", "merged_desc", "author", "repo"]).catch("created_desc").parse(first(raw.sort));
  const q = (first(raw.q) ?? "").replace(/\s+/g, " ").trim().slice(0, 100);

  return {
    range,
    members,
    repos,
    includeArchived: first(raw.archived) === "1",
    group,
    metrics: ordered.length ? ordered : DEFAULT_METRICS,
    // En el listado no hay gráfica: el listado es la tabla.
    chart: group === "detail" ? { ...DEFAULT_CHART, type: "none" } : { type, by, metric, top },
    prs: { states, dateBy, q, sort },
  };
}

/** Texto de query ("a=1&a=2&b=3") → forma que entiende parseSpec. */
export function queryToRaw(query: string): Record<string, string[]> {
  const p = new URLSearchParams(query);
  const out: Record<string, string[]> = {};
  for (const k of new Set(p.keys())) out[k] = p.getAll(k);
  return out;
}

/** Inverso de parseSpec: parámetros de URL para enlaces y para el endpoint de exportación. */
export function specToParams(spec: ReportSpec): URLSearchParams {
  const p = new URLSearchParams();
  p.set("from", weekParam(spec.range.start));
  p.set("to", weekParam(spec.range.end));
  for (const m of spec.members) p.append("members", m);
  for (const r of spec.repos) p.append("repos", r);
  if (spec.includeArchived) p.set("archived", "1");
  p.set("group", spec.group);
  for (const m of spec.metrics) p.append("m", m);
  p.set("ct", spec.chart.type);
  p.set("cb", spec.chart.by);
  p.set("cm", spec.chart.metric);
  p.set("top", String(spec.chart.top));
  if (spec.group === "detail") {
    for (const st of spec.prs.states) p.append("st", st);
    p.set("db", spec.prs.dateBy);
    p.set("sort", spec.prs.sort);
    if (spec.prs.q) p.set("q", spec.prs.q);
  }
  return p;
}

// ───────── Cuerpo del endpoint de exportación ─────────

export const FORMATS = ["xlsx", "pdf"] as const;
export type ExportFormat = (typeof FORMATS)[number];

const MAX_PNG_BYTES = 3 * 1024 * 1024;

export const exportBodySchema = z.object({
  format: z.enum(FORMATS),
  /** Los mismos parámetros que la URL del reporte, como texto (se revalidan con parseSpec). */
  query: z.string().max(20_000),
  /** PNG de la gráfica en base64 (opcional). */
  chartPng: z.string().max(Math.ceil((MAX_PNG_BYTES * 4) / 3) + 64).optional(),
});

/** Valida que sea un PNG real y de tamaño razonable; devuelve los bytes o null. */
export function decodeChartPng(b64: string | undefined): Buffer | null {
  if (!b64) return null;
  const data = b64.replace(/^data:image\/png;base64,/, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  const buf = Buffer.from(data, "base64");
  if (buf.length < 100 || buf.length > MAX_PNG_BYTES) return null;
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null; // firma PNG
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20); // IHDR
  if (w < 100 || h < 100 || w > 4000 || h > 4000) return null;
  return buf;
}

export { MAX_RANGE_WEEKS };
