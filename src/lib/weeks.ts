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

export function formatWeekRange(start: Date): string {
  const a = new Date(start.getTime() + offsetMs());
  const b = new Date(a.getTime() + 6 * 24 * 3600 * 1000);
  return `${fmt.format(a)} – ${fmtY.format(b)}`;
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
