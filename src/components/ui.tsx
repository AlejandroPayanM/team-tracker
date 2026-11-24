import Link from "next/link";
import { addWeeks, formatWeekRange, startOfWeek, weekParam } from "@/lib/weeks";

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
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs. semana previa
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
}: {
  values: number[];
  labels: string[];
  color?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-32 items-end gap-2" role="img" aria-label={labels.map((l, i) => `${l}: ${values[i]}`).join(", ")}>
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${labels[i]}: ${v}`}>
          <span className="text-xs text-slate-600">{v}</span>
          <div className={`w-full rounded-t ${color}`} style={{ height: `${Math.max((v / max) * 80, v ? 4 : 1)}px` }} />
          <span className="text-[10px] text-slate-400">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function WeekNav({ base, week }: { base: string; week: Date }) {
  const current = startOfWeek(new Date());
  const isCurrent = week.getTime() >= current.getTime();
  return (
    <div className="flex items-center gap-2 text-sm">
      <Link className="btn-ghost" href={`${base}?week=${weekParam(addWeeks(week, -1))}`}>
        ←
      </Link>
      <span className="min-w-52 text-center font-medium">{formatWeekRange(week)}</span>
      {isCurrent ? (
        <span className="btn-ghost pointer-events-none opacity-40">→</span>
      ) : (
        <Link className="btn-ghost" href={`${base}?week=${weekParam(addWeeks(week, 1))}`}>
          →
        </Link>
      )}
      {!isCurrent && (
        <Link className="text-indigo-600 hover:underline" href={base}>
          Esta semana
        </Link>
      )}
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
