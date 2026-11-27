import Link from "next/link";
import { db } from "@/lib/db";
import { getScope } from "@/lib/access";
import { listRepos } from "@/lib/filters";
import { addWeeks, startOfWeek, weekParam } from "@/lib/weeks";
import { buildReport, formatValue } from "@/lib/reports/build";
import { renderChartSvg, renderReportCardSvg } from "@/lib/reports/chart";
import {
  CHART_DIMS,
  CHART_TYPES,
  DATE_BY,
  GROUPS,
  PR_STATES,
  SORTS,
  METRICS,
  METRIC_KEYS,
  parseSpec,
  specToParams,
  type ReportSpec,
} from "@/lib/reports/spec";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ExportButtons } from "@/components/export-buttons";
import { FilterSheet } from "@/components/filter-sheet";
import { ListFilter } from "@/components/list-filter";
import { Badge } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UI_ROWS = 200;
const UI_ROWS_LIST = 300;
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
  const scope = await getScope();
  const ids = await scope.memberIds();
  const spec = parseSpec(await searchParams);
  const [members, repos, report] = await Promise.all([
    db.member.findMany({ where: scope.where, orderBy: { name: "asc" }, select: { id: true, name: true, archivedAt: true } }),
    listRepos(ids),
    buildReport(spec, scope.where),
  ]);

  // Dos versiones de la gráfica: ancha (≥ 640 px) y angosta con texto legible para celular.
  const chartSvg = report.chart ? renderChartSvg(report.chart) : null;
  const chartSvgMobile = report.chart ? renderChartSvg(report.chart, 340) : null; // ≈ ancho útil de un celular: el texto casi no se reduce
  const cardSvg = renderReportCardSvg(report);
  const query = specToParams(spec).toString();

  const isList = spec.group === "detail";
  const checked = (cond: boolean) => (cond ? { defaultChecked: true } : {});
  const shownRows = report.rows.slice(0, isList ? UI_ROWS_LIST : UI_ROWS);
  const primaryKey = report.columns[0]?.key === "group" ? "group" : "title";
  const numeric = (k: string) => {
    const kind = report.columns.find((c) => c.key === k)?.kind;
    return kind === "int" || kind === "hours";
  };
  const hideOnMobile = (k: string) => (MOBILE_HIDE.has(k) ? "max-sm:hidden" : "");

  return (
    <>
      <PageHeader title="Reportes" description="Arma un reporte con filtros, métricas y una gráfica a tu elección, y expórtalo a Excel, PDF o imagen." />

      {/* Dos tipos de reporte: cifras agrupadas, o la lista de PRs uno por uno. */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-xs sm:inline-grid sm:w-auto" role="tablist" aria-label="Tipo de reporte">
        {[
          { label: "Métricas", href: "/reports", on: !isList },
          { label: "Listado de PRs", href: "/reports?group=detail", on: isList },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={t.on}
            className={`flex min-h-10 items-center justify-center rounded-lg px-5 text-sm font-medium transition ${t.on ? "bg-indigo-600 text-white shadow-xs" : "text-slate-600 hover:bg-slate-50 active:bg-slate-100"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <FilterSheet
        label={isList ? "Configurar listado" : "Configurar reporte"}
        title={isList ? "Configurar listado de PRs" : "Configurar reporte"}
        summary={
          isList
            ? [
                spec.prs.dateBy === "all" ? "sin límite de fechas" : `${weekParam(spec.range.start)} → ${weekParam(spec.range.end)}`,
                spec.members.length ? `${spec.members.length} personas` : "todas las personas",
                spec.repos.length ? `${spec.repos.length} repos` : "todos los repos",
              ]
            : [`${weekParam(spec.range.start)} → ${weekParam(spec.range.end)}`, GROUPS[spec.group], `${spec.metrics.length} métricas`]
        }
      >
        <form method="get" action="/reports" className="space-y-3">
          {isList && <input type="hidden" name="group" value="detail" />}
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
            {isList && (
              <label className="block text-xs font-medium text-slate-500">
                ¿Qué PRs entran en el periodo?
                <select name="db" defaultValue={spec.prs.dateBy} className="input mt-1">
                  {Object.entries(DATE_BY).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </Section>

          <Section
            title="Filtros"
            hint={`${spec.members.length ? `${spec.members.length} personas` : "todas las personas"} · ${spec.repos.length ? `${spec.repos.length} repos` : "todos los repos"}`}
            open={spec.members.length > 0 || spec.repos.length > 0}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Personas</p>
                <ListFilter placeholder="Buscar persona…" noun="personas" className="space-y-2">
                <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5 text-sm">
                  {members.map((m) => (
                    <label key={m.id} data-search={m.name} className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-slate-50">
                      <input type="checkbox" name="members" value={m.id} className={checkbox} {...checked(spec.members.includes(m.id))} />
                      <span className="min-w-0 truncate">{m.name}</span>
                      {m.archivedAt && <span className="text-xs text-slate-400">(archivado)</span>}
                    </label>
                  ))}
                  {members.length === 0 && <p className="p-2 text-slate-500">Aún no hay compañeros.</p>}
                </div>
                </ListFilter>
                <label className="mt-2 flex min-h-10 items-center gap-3 text-xs text-slate-600">
                  <input type="checkbox" name="archived" value="1" className={checkbox} {...checked(spec.includeArchived)} />
                  Incluir archivados cuando no elijo personas
                </label>
                <p className="text-xs text-slate-500">Sin selección = todas las personas activas.</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Repositorios</p>
                <ListFilter placeholder="Buscar repositorio…" noun="repositorios" className="space-y-2">
                <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5 text-sm">
                  {repos.map((r) => (
                    <label key={r} data-search={r} className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-slate-50">
                      <input type="checkbox" name="repos" value={r} className={checkbox} {...checked(spec.repos.includes(r))} />
                      <span className="min-w-0 break-all">{r}</span>
                    </label>
                  ))}
                  {repos.length === 0 && <p className="p-2 text-slate-500">Aún no hay repositorios sincronizados.</p>}
                </div>
                </ListFilter>
                {!isList && <p className="mt-2 text-xs text-slate-500">Con repositorios elegidos no se incluyen tareas de Zoho.</p>}
              </div>
            </div>
          </Section>

          {isList && (
          <Section
            title="Estado y búsqueda"
            hint={`${spec.prs.states.length ? spec.prs.states.map((k) => PR_STATES[k].toLowerCase()).join(", ") : "todos los estados"}${spec.prs.q ? ` · «${spec.prs.q}»` : ""}`}
            open
          >
            <fieldset>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado del PR</legend>
              <div className="grid gap-x-4 sm:grid-cols-2">
                {Object.entries(PR_STATES).map(([k, label]) => (
                  <label key={k} className="flex min-h-10 items-center gap-3 text-sm">
                    <input type="checkbox" name="st" value={k} className={checkbox} {...checked(spec.prs.states.includes(k as keyof typeof PR_STATES))} />
                    {label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">Sin selección = todos los estados.</p>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-500">
                Buscar en título, repositorio o número
                <input type="search" name="q" defaultValue={spec.prs.q} maxLength={100} placeholder="Ej. login, #154…" className="input mt-1" />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Orden
                <select name="sort" defaultValue={spec.prs.sort} className="input mt-1">
                  {Object.entries(SORTS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Section>
          )}

          {!isList && (
          <>
          <Section title="Agrupar y métricas" hint={`${GROUPS[spec.group]} · ${spec.metrics.length} métricas`} open>
            <div className="grid gap-4 md:grid-cols-[minmax(0,16rem)_1fr]">
              <label className="block text-xs font-medium text-slate-500">
                Agrupar por
                <select name="group" defaultValue={spec.group} className="input mt-1">
                  {Object.entries(GROUPS)
                    .filter(([k]) => k !== "detail")
                    .map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                </select>
                <span className="mt-1 block font-normal">
                  ¿Quieres ver cada PR por separado? Usa{" "}
                  <Link href="/reports?group=detail" className="font-medium text-indigo-600 underline">Listado de PRs</Link>.
                </span>
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
          </>
          )}

          {/* En celular se queda a la vista mientras se recorre el formulario largo. */}
          <div className="pb-safe max-lg:sticky max-lg:bottom-0 max-lg:-mx-4 max-lg:border-t max-lg:border-slate-100 max-lg:bg-white/95 max-lg:px-4 max-lg:pt-3 max-lg:backdrop-blur">
            <button type="submit" className="btn w-full sm:w-auto">
              Generar reporte
            </button>
          </div>
        </form>
      </FilterSheet>

      {/* Resultado */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{report.title}</h2>
            <ul className="mt-0.5 space-y-0.5 text-xs text-slate-500">
              {report.subtitle.slice(0, isList ? 4 : 3).map((l) => (
                <li key={l} className="break-words">
                  {l}
                </li>
              ))}
            </ul>
          </div>
          <ExportButtons query={query} chartSvg={chartSvg} cardSvg={cardSvg} />
        </div>

        {report.kpis.length > 0 && (
          // En celular los indicadores van en una tira que se desliza (ocupa una fila en vez de cuatro).
          <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 max-md:*:w-36 max-md:*:shrink-0 max-md:*:snap-start md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 md:pb-0">
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
          ) : isList ? (
            <ListFilter placeholder="Filtrar esta lista: título, autor, repositorio…" noun="PRs" className="space-y-3">
              <div className="scroll-x -mx-4 sm:-mx-5">
                <table className="rtable w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {["PR", "Autor", "Estado", "Creado", "Mergeado", "Cambios"].map((h) => (
                        <th key={h} className="th">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 max-sm:mx-4 max-sm:block">
                    {shownRows.map((r, i) => {
                      const url = typeof r.url === "string" ? r.url : null;
                      const ref = `${r.repo}#${r.number}`;
                      const state = String(r.state ?? "");
                      return (
                        <tr key={i} className="hover:bg-slate-50" data-search={`${ref} ${r.title} ${r.author} ${r.team ?? ""} ${state}`}>
                          <td className="td" data-primary>
                            <div className="min-w-0">
                              {url ? (
                                <a href={url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-indigo-700 hover:underline">
                                  {ref}
                                </a>
                              ) : (
                                <span className="break-all font-medium">{ref}</span>
                              )}
                              <div className="max-w-xl truncate text-xs font-normal text-slate-500 max-sm:max-w-none max-sm:whitespace-normal">{String(r.title ?? "")}</div>
                            </div>
                          </td>
                          <td className="td" data-label="Autor">
                            {String(r.author ?? "—")}
                            {r.team ? <div className="text-xs text-slate-500">{String(r.team)}</div> : null}
                          </td>
                          <td className="td" data-label="Estado">
                            <Badge tone={state === "Mergeado" ? "purple" : state === "Abierto" ? "green" : state === "Borrador" ? "gray" : "red"}>{state}</Badge>
                          </td>
                          <td className="td whitespace-nowrap" data-label="Creado">{formatValue("date", r.createdAt ?? null)}</td>
                          <td className="td whitespace-nowrap" data-label="Mergeado">{formatValue("date", r.mergedAt ?? null)}</td>
                          <td className="td text-xs" data-label="Cambios" data-wide>
                            <span>
                              <span className="text-emerald-700">+{String(r.additions ?? 0)}</span> / <span className="text-red-700">−{String(r.deletions ?? 0)}</span> · {String(r.changedFiles ?? 0)} arch.
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ListFilter>
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
          {report.rows.length > shownRows.length && (
            <p className="mt-3 text-xs text-slate-500">
              Se muestran {shownRows.length} de {report.rows.length.toLocaleString("es-MX")} filas. El archivo exportado incluye todas.
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
