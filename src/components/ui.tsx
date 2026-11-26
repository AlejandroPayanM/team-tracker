import Link from "next/link";
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
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, prev }: { label: string; value: number | string; prev?: number }) {
  const delta = typeof value === "number" && prev !== undefined ? value - prev : null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{value}</span>
        {delta !== null && delta !== 0 && (
          <span className={`text-xs font-medium ${delta > 0 ? "text-emerald-600" : "text-slate-500"}`}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs. periodo previo
          </span>
        )}
      </div>
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
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
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
  return (
    <div
      className={`flex h-32 items-end ${dense ? "gap-0.5" : "gap-2"}`}
      role="img"
      aria-label={labels.map((l, i) => `${l}: ${values[i]}`).join(", ")}
    >
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-1 ${i < dim ? "opacity-35" : ""}`}
          title={`${labels[i]}: ${v}`}
        >
          {!dense && <span className="text-xs text-slate-600">{v}</span>}
          <div className={`w-full rounded-t ${color}`} style={{ height: `${Math.max((v / max) * 80, v ? 4 : 1)}px` }} />
          <span className="h-3 whitespace-nowrap text-[10px] text-slate-400">{dense && i % 4 !== 0 ? "" : labels[i]}</span>
        </div>
      ))}
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
 * Selector de rango de semanas: atajos, flechas por bloques y dos fechas libres (GET, sin JS).
 * Si recibe `repos` agrega un filtro por repositorio ("Todos" por defecto) que se conserva al navegar.
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
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link className="btn-ghost" href={href(addWeeks(range.start, -range.weeks), addWeeks(range.end, -range.weeks))} aria-label="Periodo anterior">
          ←
        </Link>
        <span className="min-w-56 text-center font-medium">
          {formatRange(range.start, range.end)}
          {range.weeks > 1 && <span className="ml-1 font-normal text-slate-500">· {range.weeks} semanas</span>}
        </span>
        {atEnd ? (
          <span className="btn-ghost pointer-events-none opacity-40">→</span>
        ) : (
          <Link className="btn-ghost" href={href(addWeeks(range.start, range.weeks), addWeeks(range.end, range.weeks))} aria-label="Periodo siguiente">
            →
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => {
          const e = addWeeks(cur, -p.offset);
          const s = addWeeks(e, -(p.n - 1));
          const active = same(s, range.start) && same(e, range.end);
          return (
            <Link
              key={p.label}
              href={href(s, e)}
              className={`rounded-full border px-2.5 py-1 text-xs ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>
      <form method="get" action={base} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">
          Desde la semana del
          <input type="date" name="from" defaultValue={weekParam(range.start)} required className="input mt-0.5 block w-auto" />
        </label>
        <label className="text-xs text-slate-500">
          hasta la semana del
          <input type="date" name="to" defaultValue={weekParam(range.end)} required className="input mt-0.5 block w-auto" />
        </label>
        {repos && (
          <label className="text-xs text-slate-500">
            Repositorio
            <select name="repo" defaultValue={repo ?? ""} className="input mt-0.5 block w-auto max-w-64">
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
        <button type="submit" className="btn-ghost">
          Ver
        </button>
      </form>
    </div>
  );
}

export function prBadge(state: string, isDraft: boolean) {
  if (state === "MERGED") return <Badge tone="purple">Merged</Badge>;
  if (state === "CLOSED") return <Badge tone="red">Cerrado</Badge>;
  return isDraft ? <Badge>Draft</Badge> : <Badge tone="green">Abierto</Badge>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}
