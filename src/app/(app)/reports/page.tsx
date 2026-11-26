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
import { Card, Empty, Stat } from "@/components/ui";
import { ExportButtons } from "@/components/export-buttons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UI_ROWS = 200;

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

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const spec = parseSpec(await searchParams);
  const [members, repos, report] = await Promise.all([
    db.member.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, archivedAt: true } }),
    listRepos(),
    buildReport(spec),
  ]);

  const chartSvg = report.chart ? renderChartSvg(report.chart) : null;
  const cardSvg = renderReportCardSvg(report);
  const query = specToParams(spec).toString();

  const checked = (cond: boolean) => (cond ? { defaultChecked: true } : {});
  const shownRows = report.rows.slice(0, UI_ROWS);

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Reportes</h1>
        <p className="text-sm text-slate-500">
          Arma un reporte con filtros, métricas y una gráfica a tu elección, y expórtalo a Excel, PDF o imagen.
        </p>
      </div>

      <Card title="Configurar reporte">
        <form method="get" action="/reports" className="space-y-5">
          {/* Periodo */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-700">Periodo</legend>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-slate-500">
                Desde la semana del
                <input type="date" name="from" defaultValue={weekParam(spec.range.start)} required className="input mt-0.5 block w-auto" />
              </label>
              <label className="text-xs text-slate-500">
                hasta la semana del
                <input type="date" name="to" defaultValue={weekParam(spec.range.end)} required className="input mt-0.5 block w-auto" />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Link key={p.label} href={presetHref(spec, p.n, p.offset)} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                  {p.label}
                </Link>
              ))}
            </div>
          </fieldset>

          {/* Filtros */}
          <fieldset className="grid gap-4 md:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-slate-700">Filtros</legend>
            <details className="rounded-md border border-slate-200 p-3" open={spec.members.length > 0}>
              <summary className="cursor-pointer text-sm font-medium">
                Personas <span className="font-normal text-slate-500">({spec.members.length ? `${spec.members.length} elegidas` : "todas"})</span>
              </summary>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-2">
                    <input type="checkbox" name="members" value={m.id} {...checked(spec.members.includes(m.id))} />
                    {m.name}
                    {m.archivedAt && <span className="text-xs text-slate-400">(archivado)</span>}
                  </label>
                ))}
                {members.length === 0 && <p className="text-slate-500">Aún no hay compañeros.</p>}
              </div>
              <label className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
                <input type="checkbox" name="archived" value="1" {...checked(spec.includeArchived)} /> Incluir archivados cuando no elijo personas
              </label>
              <p className="mt-1 text-xs text-slate-500">Sin selección = todas las personas activas.</p>
            </details>
            <details className="rounded-md border border-slate-200 p-3" open={spec.repos.length > 0}>
              <summary className="cursor-pointer text-sm font-medium">
                Repositorios <span className="font-normal text-slate-500">({spec.repos.length ? `${spec.repos.length} elegidos` : "todos"})</span>
              </summary>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
                {repos.map((r) => (
                  <label key={r} className="flex items-center gap-2">
                    <input type="checkbox" name="repos" value={r} {...checked(spec.repos.includes(r))} />
                    {r}
                  </label>
                ))}
                {repos.length === 0 && <p className="text-slate-500">Aún no hay repositorios sincronizados.</p>}
              </div>
              <p className="mt-1 text-xs text-slate-500">Con repositorios elegidos no se incluyen tareas de Zoho.</p>
            </details>
          </fieldset>

          {/* Agrupación y métricas */}
          <fieldset className="grid gap-4 md:grid-cols-2">
            <div>
              <legend className="mb-2 text-sm font-semibold text-slate-700">Agrupar por</legend>
              <select name="group" defaultValue={spec.group} className="input w-auto">
                {Object.entries(GROUPS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">«Detalle de PRs» lista cada PR en una fila (las métricas elegidas se usan en indicadores y gráfica).</p>
            </div>
            <div>
              <legend className="mb-2 text-sm font-semibold text-slate-700">Métricas</legend>
              <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                {METRIC_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="checkbox" name="m" value={k} {...checked(spec.metrics.includes(k))} />
                    {METRICS[k].label}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>

          {/* Gráfica */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-700">Gráfica</legend>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-slate-500">
                Tipo
                <select name="ct" defaultValue={spec.chart.type} className="input mt-0.5 block w-auto">
                  {Object.entries(CHART_TYPES).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Graficar por
                <select name="cb" defaultValue={spec.chart.by} className="input mt-0.5 block w-auto">
                  {Object.entries(CHART_DIMS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Métrica
                <select name="cm" defaultValue={spec.chart.metric} className="input mt-0.5 block w-auto">
                  {METRIC_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {METRICS[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Mostrar los primeros
                <input type="number" name="top" min={3} max={25} defaultValue={spec.chart.top} className="input mt-0.5 block w-20" />
              </label>
            </div>
          </fieldset>

          <button type="submit" className="btn">
            Generar reporte
          </button>
        </form>
      </Card>

      {/* Resultado */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{report.title}</h2>
            <ul className="text-xs text-slate-500">
              {report.subtitle.slice(0, 3).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
          <ExportButtons query={query} chartSvg={chartSvg} cardSvg={cardSvg} />
        </div>

        {report.kpis.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {report.kpis.map((k) => (
              <Stat key={k.label} label={k.label} value={k.value} />
            ))}
          </div>
        )}

        {chartSvg && (
          <Card>
            {/* SVG generado en el servidor; todo el texto está escapado. */}
            <div className="mx-auto max-w-4xl [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: chartSvg }} />
          </Card>
        )}

        <Card title={`Datos${report.totalRows ? ` (${report.totalRows.toLocaleString("es-MX")} fila${report.totalRows === 1 ? "" : "s"})` : ""}`}>
          {report.rows.length === 0 ? (
            <Empty>Sin datos para estos filtros.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    {report.columns.map((c) => (
                      <th key={c.key} className={`th ${c.kind === "int" || c.kind === "hours" ? "text-right" : ""}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shownRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {report.columns.map((c) => {
                        const v = row[c.key] ?? null;
                        return (
                          <td key={c.key} className={`td ${c.kind === "int" || c.kind === "hours" ? "text-right tabular-nums" : ""} ${c.key === "title" ? "max-w-sm truncate" : ""}`}>
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
                        <td key={c.key} className={`td ${c.kind === "int" || c.kind === "hours" ? "text-right tabular-nums" : ""}`}>
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
