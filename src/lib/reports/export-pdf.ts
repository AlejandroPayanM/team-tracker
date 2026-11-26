import PDFDocument from "pdfkit";
import { formatValue, type Report, type ReportColumn } from "./build";

export const PDF_MAX_ROWS = 1500;

// Las fuentes estándar de PDF usan WinAnsi: se conservan los acentos y signos comunes; el resto se sustituye.
const SAFE = /[^ -~ -ÿ–—‘’“”•…€]/g;
const win = (s: string) => s.replace(/−/g, "-").replace(SAFE, "?");

const INK = "#0f172a";
const MUTED = "#64748b";

/**
 * PDF horizontal (A4): título y filtros, indicadores, gráfica (PNG enviado por el navegador), notas y la tabla
 * paginada con encabezado repetido y numeración de páginas.
 */
export function buildPdf(report: Report, chartPng: Buffer | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36,
      bufferPages: true,
      info: { Title: win(report.title), Author: "Team Tracker", CreationDate: report.generatedAt },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const pageW = doc.page.width - left - doc.page.margins.right;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 18;

    // Título y filtros
    doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(win(report.title), left, doc.y);
    doc.moveDown(0.3).font("Helvetica").fontSize(9).fillColor(MUTED);
    for (const line of report.subtitle) doc.text(win(line), { width: pageW });
    doc.moveDown(0.8);

    // Indicadores
    const kpis = report.kpis.slice(0, 8);
    if (kpis.length) {
      const cols = 4;
      const gap = 10;
      const bw = (pageW - gap * (cols - 1)) / cols;
      const top = doc.y;
      kpis.forEach((k, i) => {
        const x = left + (i % cols) * (bw + gap);
        const y = top + Math.floor(i / cols) * 46;
        doc.roundedRect(x, y, bw, 38, 5).lineWidth(0.6).strokeColor("#cbd5e1").fillAndStroke("#f8fafc", "#cbd5e1");
        doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(win(k.label), x + 8, y + 7, { width: bw - 16, lineBreak: false });
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(win(k.value), x + 8, y + 19, { width: bw - 16, lineBreak: false });
      });
      doc.y = top + Math.ceil(kpis.length / cols) * 46 + 4;
    }

    // Gráfica
    if (chartPng) {
      const maxH = 250;
      if (doc.y + maxH > bottomLimit()) doc.addPage();
      doc.image(chartPng, left, doc.y, { fit: [pageW, maxH], align: "center" });
      doc.y += maxH + 6;
    }

    // Notas
    doc.font("Helvetica-Oblique").fontSize(8).fillColor(MUTED);
    for (const n of report.notes) {
      if (doc.y > bottomLimit()) doc.addPage();
      doc.text(win(n), left, doc.y, { width: pageW });
    }
    doc.moveDown(0.6);

    // Tabla
    const rowsAll = report.rows.slice(0, PDF_MAX_ROWS);
    const cols = report.columns;
    const totalW = cols.reduce((a, c) => a + c.width, 0);
    const widths = cols.map((c) => (c.width / totalW) * pageW);
    const fontSize = cols.length > 9 ? 6.5 : cols.length > 6 ? 7.5 : 9;
    const rowH = fontSize + 7;

    const cellText = (c: ReportColumn, v: Report["rows"][number][string], w: number): string => {
      let s = win(c.kind === "link" ? String(v ?? "") : formatValue(c.kind, v ?? null));
      doc.font("Helvetica").fontSize(fontSize);
      if (doc.widthOfString(s) <= w - 8) return s;
      while (s.length > 1 && doc.widthOfString(`${s}...`) > w - 8) s = s.slice(0, -1);
      return `${s}...`;
    };

    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, pageW, rowH + 3).fill("#1e293b");
      let x = left;
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(fontSize);
      cols.forEach((c, i) => {
        doc.text(win(c.label), x + 4, y + 4, { width: widths[i]! - 8, lineBreak: false, align: c.kind === "int" || c.kind === "hours" ? "right" : "left" });
        x += widths[i]!;
      });
      doc.y = y + rowH + 3;
    };

    const drawRow = (row: Report["rows"][number], i: number, bold = false) => {
      if (doc.y + rowH > bottomLimit()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      if (bold) doc.rect(left, y, pageW, rowH).fill("#e2e8f0");
      else if (i % 2 === 1) doc.rect(left, y, pageW, rowH).fill("#f8fafc");
      let x = left;
      doc.fillColor(INK).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
      cols.forEach((c, ci) => {
        doc.text(cellText(c, row[c.key] ?? null, widths[ci]!), x + 4, y + 3.5, {
          width: widths[ci]! - 8,
          lineBreak: false,
          align: c.kind === "int" || c.kind === "hours" ? "right" : "left",
        });
        x += widths[ci]!;
      });
      doc.y = y + rowH;
    };

    if (doc.y + rowH * 3 > bottomLimit()) doc.addPage();
    drawHeader();
    rowsAll.forEach((row, i) => drawRow(row, i));
    if (report.totals) drawRow(report.totals, 0, true);
    if (report.rows.length > rowsAll.length || report.truncated) {
      doc.moveDown(0.5).font("Helvetica-Oblique").fontSize(8).fillColor(MUTED);
      doc.text(
        win(`Se muestran ${rowsAll.length.toLocaleString("es-MX")} de ${report.totalRows.toLocaleString("es-MX")} filas. Descarga el Excel para ver todas.`),
        left,
        doc.y,
        { width: pageW },
      );
    }

    // Pie de página con numeración (se dibuja con margen inferior en 0 para no provocar páginas nuevas).
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(8).fillColor(MUTED);
      doc.text(win(`Team Tracker · ${report.subtitle[3] ?? ""}`), left, doc.page.height - 26, { width: pageW / 2, lineBreak: false });
      doc.text(`Página ${p + 1} de ${range.count}`, left + pageW / 2, doc.page.height - 26, { width: pageW / 2, align: "right", lineBreak: false });
      doc.page.margins.bottom = saved;
    }
    doc.end();
  });
}
