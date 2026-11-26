import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { listRepos } from "@/lib/filters";
import { addWeeks, startOfWeek, weekParam } from "@/lib/weeks";
import { buildReport, formatValue } from "@/lib/reports/build";
import { renderChartSvg, renderReportCardSvg } from "@/lib/reports/chart";
import {
  CHART_DIMS,
  CHART_TYPES,
  GROUPS,
  METRICS,
  METRIC_KEYS,
  parseSpec,
  specToParams,
  type ReportSpec,
} from "@/lib/reports/spec";
import { Card, Empty, PageHeader, STAT_GRID_4, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ExportButtons } from "@/components/export-buttons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UI_ROWS = 200;
/** Columnas del detalle de PRs que en celular se omiten para que cada tarjeta no sea interminable (siguen en la tabla ancha y en los archivos). */
const MOBILE_HIDE = new Set(["closedAt", "changedFiles", "mergeHours"]);

const PRESETS = [
  { label: "Esta semana", n: 1, offset: 0 },
  { label: "Semana pasada", n: 1, offset: 1 },
  { label: "Últimas 4", n: 4, offset: 0 },
  { label: "Últimas 8", n: 8, offset: 0 },
  { label: "Últimas 12", n: 12, offset: 0 },
  { label: "Últimas 26", n: 26, offset: 0 },
  { label: "Últimas 52", n: 52, offset: 0 },
];

function presetHref(spec: ReportSpec, n: number, offset: number): string {
  const end = addWeeks(startOfWeek(new Date()), -offset);
  const p = specToParams(spec);
  p.set("from", weekParam(addWeeks(end, -(n - 1))));
  p.set("to", weekParam(end));
  return `/reports?${p.toString()}`;
}

const checkbox = "h-5 w-5 shrink-0 rounded border-slate-300 accent-indigo-600";

/** Sección plegable del formulario: en pantallas chicas deja el formulario corto y manejable. */
function Section({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-slate-200" open={open || undefined}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        {hint && <span className="min-w-0 truncate text-xs font-normal text-slate-500">{hint}</span>}
        <Icon name="chevron" className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const spec = parseSpec(await searchParams);
  const [members, repos, report] = await Promise.all([
    db.member.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, archivedAt: true } }),
    listRepos(),
    buildReport(spec),
  ]);

  // Dos versiones de la gráfica: ancha (≥ 640 px) y angosta con texto legible para celular.
  const chartSvg = report.chart ? renderChartSvg(report.chart) : null;
  const chartSvgMobile = report.chart ? renderChartSvg(report.chart, 340) : null; // ≈ ancho útil de un celular: el texto casi no se reduce
  const cardSvg = renderReportCardSvg(report);
  const query = specToParams(spec).toString();

  const checked = (cond: boolean) => (cond ? { defaultChecked: true } : {});
  const shownRows = report.rows.slice(0, UI_ROWS);
  const primaryKey = report.columns[0]?.key === "group" ? "group" : "title";
  const numeric = (k: string) => {
    const kind = report.columns.find((c) => c.key === k)?.kind;
    return kind === "int" || kind === "hours";
  };
  const hideOnMobile = (k: string) => (MOBILE_HIDE.has(k) ? "max-sm:hidden" : "");

  return (
    <>
      <PageHeader title="Reportes" description="Arma un reporte con filtros, métricas y una gráfica a tu elección, y expórtalo a Excel, PDF o imagen." />

      <Card>
        <form method="get" action="/reports" className="space-y-3">
          <Section title="Periodo" hint={`${weekParam(spec.range.start)} → ${weekParam(spec.range.end)}`} open>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-500">
                Desde la semana del
                <input type="date" name="from" defaultValue={weekParam(spec.range.start)} required className="input mt-1" />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Hasta la semana del
                <input type="date" name="to" defaultValue={weekParam(spec.range.end)} required className="input mt-1" />
              </label>
            </div>
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5" role="group" aria-label="Atajos de periodo">
              {PRESETS.map((p) => (
                <Link key={p.label} href={presetHref(spec, p.n, p.offset)} className="chip">
                  {p.label}
                </Link>
              ))}
            </div>
          </Section>

          <Section
            title="Filtros"
            hint={`${spec.members.length ? `${spec.members.length} personas` : "todas las personas"} · ${spec.repos.length ? `${spec.repos.length} repos` : "todos los repos"}`}
            open={spec.members.length > 0 || spec.repos.length > 0}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Personas</p>
                <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5 text-sm">
                  {members.map((m) => (
                    <label key={m.id} className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-slate-50">
                      <input type="checkbox" name="members" value={m.id} className={checkbox} {...checked(spec.members.includes(m.id))} />
                      <span className="min-w-0 truncate">{m.name}</span>
                      {m.archivedAt && <span className="text-xs text-slate-400">(archivado)</span>}
                    </label>
                  ))}
                  {members.length === 0 && <p className="p-2 text-slate-500">Aún no hay compañeros.</p>}
                </div>
                <label className="mt-2 flex min-h-10 items-center gap-3 text-xs text-slate-600">
                  <input type="checkbox" name="archived" value="1" className={checkbox} {...checked(spec.includeArchived)} />
                  Incluir archivados cuando no elijo personas
                </label>
                <p className="text-xs text-slate-500">Sin selección = todas las personas activas.</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Repositorios</p>
                <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5 text-sm">
                  {repos.map((r) => (
                    <label key={r} className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-slate-50">
                      <input type="checkbox" name="repos" value={r} className={checkbox} {...checked(spec.repos.includes(r))} />
                      <span className="min-w-0 break-all">{r}</span>
                    </label>
                  ))}
                  {repos.length === 0 && <p className="p-2 text-slate-500">Aún no hay repositorios sincronizados.</p>}
                </div>
                <p className="mt-2 text-xs text-slate-500">Con repositorios elegidos no se incluyen tareas de Zoho.</p>
              </div>
            </div>
          </Section>

          <Section title="Agrupar y métricas" hint={`${GROUPS[spec.group]} · ${spec.metrics.length} métricas`} open>
            <div className="grid gap-4 md:grid-cols-[minmax(0,16rem)_1fr]">
              <label className="block text-xs font-medium text-slate-500">
                Agrupar por
                <select name="group" defaultValue={spec.group} className="input mt-1">
                  {Object.entries(GROUPS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block font-normal">«Detalle de PRs» lista cada PR en una fila.</span>
              </label>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Métricas</p>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  {METRIC_KEYS.map((k) => (
                    <label key={k} className="flex min-h-10 items-center gap-3 text-sm">
                      <input type="checkbox" name="m" value={k} className={checkbox} {...checked(spec.metrics.includes(k))} />
                      {METRICS[k].label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Gráfica" hint={`${CHART_TYPES[spec.chart.type]}${spec.chart.type === "none" ? "" : ` · por ${CHART_DIMS[spec.chart.by].toLowerCase()}`}`} open>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-xs font-medium text-slate-500">
                Tipo
                <select name="ct" defaultValue={spec.chart.type} className="input mt-1">
                  {Object.entries(CHART_TYPES).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Graficar por
                <select name="cb" defaultValue={spec.chart.by} className="input mt-1">
                  {Object.entries(CHART_DIMS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Métrica
                <select name="cm" defaultValue={spec.chart.metric} className="input mt-1">
                  {METRIC_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {METRICS[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Mostrar los primeros
                <input type="number" name="top" min={3} max={25} defaultValue={spec.chart.top} className="input mt-1" inputMode="numeric" />
              </label>
            </div>
          </Section>

          {/* Se queda a la vista mientras se recorre el formulario largo. */}
          <div className="pb-safe sticky bottom-0 -mx-4 -mb-4 border-t border-slate-100 bg-white/95 px-4 pt-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:px-5">
            <button type="submit" className="btn w-full sm:w-auto">
              Generar reporte
            </button>
          </div>
        </form>
      </Card>

      {/* Resultado */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{report.title}</h2>
            <ul className="mt-0.5 space-y-0.5 text-xs text-slate-500">
              {report.subtitle.slice(0, 3).map((l) => (
                <li key={l} className="break-words">
                  {l}
                </li>
              ))}
            </ul>
          </div>
          <ExportButtons query={query} chartSvg={chartSvg} cardSvg={cardSvg} />
        </div>

        {report.kpis.length > 0 && (
          <div className={STAT_GRID_4}>
            {report.kpis.map((k) => (
              <Stat key={k.label} label={k.label} value={k.value} />
            ))}
          </div>
        )}

        {chartSvg && chartSvgMobile && (
          <Card>
            {/* SVG generado en el servidor; todo el texto está escapado. */}
            <div className="mx-auto hidden max-w-4xl sm:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: chartSvg }} />
            <div className="mx-auto max-w-md sm:hidden [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: chartSvgMobile }} />
          </Card>
        )}

        <Card title={`Datos${report.totalRows ? ` (${report.totalRows.toLocaleString("es-MX")} fila${report.totalRows === 1 ? "" : "s"})` : ""}`}>
          {report.rows.length === 0 ? (
            <Empty>Sin datos para estos filtros.</Empty>
          ) : (
            <div className="scroll-x -mx-4 sm:-mx-5">
              <table className="rtable w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    {report.columns.map((c) => (
                      <th key={c.key} className={`th ${numeric(c.key) ? "text-right" : ""}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 max-sm:mx-4 max-sm:block">
                  {shownRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {report.columns.map((c) => {
                        const v = row[c.key] ?? null;
                        const primary = c.key === primaryKey;
                        return (
                          <td
                            key={c.key}
                            {...(primary ? { "data-primary": true } : { "data-label": c.label })}
                            className={`td ${numeric(c.key) ? "text-right tabular-nums" : ""} ${c.key === "title" ? "max-w-sm truncate max-sm:max-w-none max-sm:whitespace-normal" : ""} ${hideOnMobile(c.key)}`}
                          >
                            {c.kind === "link" && typeof v === "string" ? (
                              <a href={v} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline">
                                abrir
                              </a>
                            ) : (
                              formatValue(c.kind, v)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {report.totals && (
                    <tr className="bg-slate-50 font-semibold">
                      {report.columns.map((c) => (
                        <td
                          key={c.key}
                          {...(c.key === primaryKey ? { "data-primary": true } : { "data-label": c.label })}
                          className={`td ${numeric(c.key) ? "text-right tabular-nums" : ""} ${hideOnMobile(c.key)}`}
                        >
                          {formatValue(c.kind, report.totals![c.key] ?? null)}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {report.rows.length > UI_ROWS && (
            <p className="mt-3 text-xs text-slate-500">
              Se muestran {UI_ROWS} de {report.rows.length.toLocaleString("es-MX")} filas. El archivo exportado incluye todas.
            </p>
          )}
          {report.notes.length > 0 && (
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
              {report.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
