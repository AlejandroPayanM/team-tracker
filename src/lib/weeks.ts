// Semanas que inician el lunes 00:00 en la zona definida por WEEK_TZ_OFFSET_MINUTES.
export const WEEK_MS = 7 * 24 * 3600 * 1000;

function offsetMs(): number {
  const n = Number(process.env.WEEK_TZ_OFFSET_MINUTES ?? 0);
  return (Number.isFinite(n) ? n : 0) * 60_000;
}

export function startOfWeek(d: Date): Date {
  const local = new Date(d.getTime() + offsetMs());
  const day = (local.getUTCDay() + 6) % 7; // lunes = 0
  local.setUTCHours(0, 0, 0, 0);
  local.setUTCDate(local.getUTCDate() - day);
  return new Date(local.getTime() - offsetMs());
}

export function addWeeks(d: Date, n: number): Date {
  return new Date(d.getTime() + n * WEEK_MS);
}

/** "2026-11-23" -> inicio de esa semana. Valores inválidos -> semana actual. */
export function parseWeekParam(s?: string | null): Date {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) return startOfWeek(new Date(d.getTime() - offsetMs()));
  }
  return startOfWeek(new Date());
}

export function weekParam(start: Date): string {
  return new Date(start.getTime() + offsetMs()).toISOString().slice(0, 10);
}

const fmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtY = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Texto del rango entre el inicio de la semana `start` y el fin de la semana que inicia en `end`. */
export function formatRange(start: Date, end: Date = start): string {
  const a = new Date(start.getTime() + offsetMs());
  const b = new Date(end.getTime() + offsetMs() + 6 * 24 * 3600 * 1000);
  const crossesYear = a.getUTCFullYear() !== b.getUTCFullYear();
  return `${(crossesYear ? fmtY : fmt).format(a)} – ${fmtY.format(b)}`;
}

export function formatWeekRange(start: Date): string {
  return formatRange(start);
}

export const MAX_RANGE_WEEKS = 52;

/** Rango de semanas completas, de la semana que inicia en `start` a la que inicia en `end` (ambas incluidas). */
export type WeekRange = { start: Date; end: Date; weeks: number };

/**
 * Lee ?from=YYYY-MM-DD&to=YYYY-MM-DD (cualquier día; se ajusta a su semana) o ?week= (una semana).
 * Sin parámetros: semana actual. Nunca pasa de la semana actual ni de 52 semanas.
 */
export function parseRange(sp: { from?: string; to?: string; week?: string }): WeekRange {
  const cur = startOfWeek(new Date());
  const f = sp.from ?? sp.week;
  const t = sp.to ?? sp.week;
  let start = f ? parseWeekParam(f) : cur;
  let end = t ? parseWeekParam(t) : cur;
  if (end > cur) end = cur;
  if (start > cur) start = cur;
  if (start > end) [start, end] = [end, start];
  let weeks = Math.round((end.getTime() - start.getTime()) / WEEK_MS) + 1;
  if (weeks > MAX_RANGE_WEEKS) {
    weeks = MAX_RANGE_WEEKS;
    start = addWeeks(end, -(MAX_RANGE_WEEKS - 1));
  }
  return { start, end, weeks };
}

/** "24 nov" para etiquetas de gráficas. */
export function shortDate(d: Date): string {
  return fmt.format(new Date(d.getTime() + offsetMs())).replace(".", "");
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return fmtY.format(new Date(d.getTime() + offsetMs()));
}

export function relativeDays(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000));
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}
