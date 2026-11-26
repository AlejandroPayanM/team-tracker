import ExcelJS from "exceljs";
import type { Report, ReportColumn } from "./build";

const NUM_FMT: Record<ReportColumn["kind"], string | undefined> = {
  text: undefined,
  link: undefined,
  int: "#,##0",
  hours: "0.0",
  date: "yyyy-mm-dd",
};

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } } as const;

/**
 * Libro de Excel: hoja «Resumen» (título, filtros, indicadores, gráfica y notas) y hoja «Datos» con la tabla
 * (encabezado fijo, filtros automáticos, formatos numéricos y fila de totales). Los textos se escriben siempre como
 * texto, nunca como fórmula.
 */
export async function buildXlsx(report: Report, chartPng: Buffer | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Team Tracker";
  wb.created = report.generatedAt;

  // ── Resumen ──
  const ws = wb.addWorksheet("Resumen", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 38 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  ws.getCell("A1").value = report.title;
  ws.getCell("A1").font = { bold: true, size: 16 };
  let r = 2;
  for (const line of report.subtitle) {
    ws.getCell(`A${r}`).value = line;
    ws.getCell(`A${r}`).font = { color: { argb: "FF64748B" }, size: 10 };
    r++;
  }
  r++;
  if (report.kpis.length) {
    ws.getCell(`A${r}`).value = "Indicador";
    ws.getCell(`B${r}`).value = "Valor";
    for (const c of ["A", "B"]) {
      ws.getCell(`${c}${r}`).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getCell(`${c}${r}`).fill = HEADER_FILL;
    }
    r++;
    for (const k of report.kpis) {
      ws.getCell(`A${r}`).value = k.label;
      ws.getCell(`B${r}`).value = k.value;
      ws.getCell(`B${r}`).alignment = { horizontal: "right" };
      r++;
    }
    r++;
  }
  if (chartPng) {
    const id = wb.addImage({ buffer: chartPng as unknown as ExcelJS.Buffer, extension: "png" });
    const width = 720;
    const height = 336;
    ws.addImage(id, { tl: { col: 0, row: r - 1 }, ext: { width, height } });
    r += Math.ceil(height / 20) + 1; // ~20 px por fila
  } else if (report.chart) {
    ws.getCell(`A${r}`).value = `Gráfica: ${report.chart.title} (disponible en la versión en pantalla)`;
    r += 2;
  }
  for (const n of report.notes) {
    ws.getCell(`A${r}`).value = n;
    ws.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: "FF64748B" } };
    r++;
  }

  // ── Datos ──
  const wd = wb.addWorksheet("Datos", { views: [{ state: "frozen", ySplit: 1 }] });
  wd.columns = report.columns.map((c) => ({ header: c.label, key: c.key, width: c.width }));
  const head = wd.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = HEADER_FILL;
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 22;

  const putRow = (row: Report["rows"][number], bold = false) => {
    const added = wd.addRow(
      report.columns.map((c) => {
        const v = row[c.key];
        if (v === null || v === undefined) return null;
        if (c.kind === "link" && typeof v === "string") return { text: v, hyperlink: v };
        return v;
      }),
    );
    report.columns.forEach((c, i) => {
      const cell = added.getCell(i + 1);
      const fmt = NUM_FMT[c.kind];
      if (fmt) cell.numFmt = fmt;
      if (c.kind === "int" || c.kind === "hours") cell.alignment = { horizontal: "right" };
      if (c.kind === "link") cell.font = { color: { argb: "FF4F46E5" }, underline: true };
    });
    if (bold) {
      added.font = { bold: true };
      added.border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
      added.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    }
  };
  for (const row of report.rows) putRow(row);
  if (report.totals) putRow(report.totals, true);
  if (report.rows.length) {
    wd.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + report.rows.length, column: report.columns.length } };
  }
  if (report.truncated) {
    wd.addRow([]);
    wd.addRow([`Se incluyen ${report.rows.length.toLocaleString("es-MX")} de ${report.totalRows.toLocaleString("es-MX")} filas.`]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
