import Link from "next/link";
import { Icon } from "@/components/icons";
import { addWeeks, formatRange, startOfWeek, weekParam, type WeekRange } from "@/lib/weeks";

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // min-w-0: sin esto, dentro de una cuadrícula el contenido (gráficas, tablas) ensancha la tarjeta más allá de la pantalla.
    <section className={`min-w-0 rounded-xl border border-slate-200 bg-white shadow-xs ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** Encabezado de página: título, descripción opcional y acciones (se apilan en pantallas chicas). */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="min-w-0 lg:max-w-[70%]">{actions}</div>}
    </div>
  );
}

/** Cuadrícula de indicadores: en celular, si queda una tarjeta suelta en la última fila, ocupa todo el ancho. */
export const STAT_GRID_5 = "grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 max-md:[&>*:last-child:nth-child(odd)]:col-span-2";
export const STAT_GRID_4 = "grid grid-cols-2 gap-3 md:grid-cols-4 max-md:[&>*:last-child:nth-child(odd)]:col-span-2";

export function Stat({ label, value, prev }: { label: string; value: number | string; prev?: number }) {
  const delta = typeof value === "number" && prev !== undefined ? value - prev : null;
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-slate-500">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{value}</div>
      {delta !== null && delta !== 0 && (
        <div
          className={`mt-1.5 inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
            delta > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          <span>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
          <span className="font-normal text-slate-500">
            <span className="sm:hidden">vs. previo</span>
            <span className="hidden sm:inline">vs. periodo previo</span>
          </span>
        </div>
      )}
    </div>
  );
}

const tones = {
  gray: "bg-slate-100 text-slate-700",
  green: "bg-emerald-100 text-emerald-800",
  purple: "bg-violet-100 text-violet-800",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-sky-100 text-sky-800",
} as const;

export function Badge({ tone = "gray", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Bars({
  values,
  labels,
  color = "bg-indigo-500",
  dim = 0,
}: {
  values: number[];
  labels: string[];
  color?: string;
  /** Cantidad de barras iniciales fuera del periodo elegido (se muestran atenuadas). */
  dim?: number;
}) {
  const max = Math.max(1, ...values);
  const dense = values.length > 16; // con muchas semanas: sin números ni etiquetas salvo cada 4.ª
  const many = values.length > 8; // si la gráfica es angosta (no la pantalla), se muestra una etiqueta de cada dos
  return (
    <div className="@container">
      <div
        className={`flex h-36 items-end ${dense ? "gap-0.5" : "gap-1.5 sm:gap-2"}`}
        role="img"
        aria-label={labels.map((l, i) => `${l}: ${values[i]}`).join(", ")}
      >
        {values.map((v, i) => (
          <div
            key={i}
            className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-1 ${i < dim ? "opacity-35" : ""}`}
            title={`${labels[i]}: ${v}`}
          >
            {!dense && <span className="text-[11px] tabular-nums text-slate-600 sm:text-xs">{v}</span>}
            <div className={`w-full rounded-t ${color}`} style={{ height: `${Math.max((v / max) * 84, v ? 4 : 1)}px` }} />
            <span className={`h-3 whitespace-nowrap text-[10px] text-slate-400 ${many && i % 2 === 1 ? "@max-[30rem]:invisible" : ""}`}>
              {dense && i % 4 !== 0 ? "" : labels[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PRESETS = [
  { label: "Esta semana", n: 1, offset: 0 },
  { label: "Semana pasada", n: 1, offset: 1 },
  { label: "Últimas 4", n: 4, offset: 0 },
  { label: "Últimas 8", n: 8, offset: 0 },
  { label: "Últimas 12", n: 12, offset: 0 },
  { label: "Últimas 26", n: 26, offset: 0 },
];

/**
 * Selector de periodo: flechas por bloques, atajos desplazables y, plegado, un panel con fechas libres y filtro de
 * repositorio (GET, sin JS). Si recibe `repos` agrega el filtro por repositorio, que se conserva al navegar.
 */
export function RangeNav({
  base,
  range,
  repos,
  repo,
}: {
  base: string;
  range: WeekRange;
  repos?: string[];
  repo?: string;
}) {
  const cur = startOfWeek(new Date());
  const href = (s: Date, e: Date) =>
    `${base}?from=${weekParam(s)}&to=${weekParam(e)}${repo ? `&repo=${encodeURIComponent(repo)}` : ""}`;
  const atEnd = range.end.getTime() >= cur.getTime();
  const same = (a: Date, b: Date) => a.getTime() === b.getTime();
  return (
    <div className="min-w-0 space-y-2.5 text-sm">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center justify-between gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-xs sm:justify-start">
          <Link
            className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 active:bg-slate-200"
            href={href(addWeeks(range.start, -range.weeks), addWeeks(range.end, -range.weeks))}
            aria-label="Periodo anterior"
          >
            <Icon name="left" />
          </Link>
          <span className="px-2 text-center text-sm font-medium tabular-nums">
            {formatRange(range.start, range.end)}
            {range.weeks > 1 && <span className="ml-1 font-normal text-slate-500">· {range.weeks} sem.</span>}
          </span>
          {atEnd ? (
            <span className="grid h-10 w-10 place-items-center rounded-lg text-slate-300" aria-hidden>
              <Icon name="right" />
            </span>
          ) : (
            <Link
              className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 active:bg-slate-200"
              href={href(addWeeks(range.start, range.weeks), addWeeks(range.end, range.weeks))}
              aria-label="Periodo siguiente"
            >
              <Icon name="right" />
            </Link>
          )}
        </div>
        <div className="no-scrollbar -mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-1 sm:px-0" role="group" aria-label="Atajos de periodo">
          {PRESETS.map((p) => {
            const e = addWeeks(cur, -p.offset);
            const s = addWeeks(e, -(p.n - 1));
            const active = same(s, range.start) && same(e, range.end);
            return (
              <Link key={p.label} href={href(s, e)} aria-current={active ? "true" : undefined} className={`chip ${active ? "chip-active" : ""}`}>
                {p.label}
              </Link>
            );
          })}
        </div>
      </div>

      <details className="group rounded-xl border border-slate-200 bg-white shadow-xs" open={Boolean(repo) || undefined}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
          <Icon name="sliders" className="h-4 w-4 text-slate-500" />
          <span className="min-w-0 truncate">
            Fechas{repos ? " y repositorio" : ""}
            {repo && <span className="font-normal text-indigo-700"> · {repo}</span>}
          </span>
          <Icon name="chevron" className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
        </summary>
        <form method="get" action={base} className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_auto] lg:items-end">
          <label className="block text-xs font-medium text-slate-500">
            Desde la semana del
            <input type="date" name="from" defaultValue={weekParam(range.start)} required className="input mt-1" />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Hasta la semana del
            <input type="date" name="to" defaultValue={weekParam(range.end)} required className="input mt-1" />
          </label>
          {repos && (
            <label className="block text-xs font-medium text-slate-500 sm:col-span-2 lg:col-span-1">
              Repositorio
              <select name="repo" defaultValue={repo ?? ""} className="input mt-1">
                <option value="">Todos los repositorios</option>
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                {repo && !repos.includes(repo) && <option value={repo}>{repo}</option>}
              </select>
            </label>
          )}
          <button type="submit" className="btn sm:col-span-2 lg:col-span-1">
            Aplicar
          </button>
        </form>
      </details>
    </div>
  );
}

export function prBadge(state: string, isDraft: boolean) {
  if (state === "MERGED") return <Badge tone="purple">Merged</Badge>;
  if (state === "CLOSED") return <Badge tone="red">Cerrado</Badge>;
  return isDraft ? <Badge>Draft</Badge> : <Badge tone="green">Abierto</Badge>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

/** Aviso informativo (filtros activos, historial pendiente…). */
export function Notice({ tone = "indigo", children }: { tone?: "indigo" | "sky" | "amber"; children: React.ReactNode }) {
  const cls = {
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-900",
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    amber: "border-amber-300 bg-amber-50 text-amber-900",
  }[tone];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}
