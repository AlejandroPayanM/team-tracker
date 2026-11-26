import type { ChartData, Report } from "./build";

// Gráficas en SVG generadas a mano (sin librerías): el mismo código dibuja la vista en pantalla y el PNG que se
// incrusta en Excel/PDF. Todo texto pasa por esc(), así que el SVG es seguro de insertar en la página.

const PALETTE = ["#4f46e5", "#f59e0b", "#10b981", "#0ea5e9", "#f43f5e", "#8b5cf6", "#14b8a6", "#ef4444", "#84cc16", "#64748b"];
const FONT = 'font-family="Arial, Helvetica, sans-serif"';
const INK = "#0f172a";
const MUTED = "#64748b";
const GRID = "#e2e8f0";

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const fmtVal = (v: number, kind: ChartData["kind"]) =>
  kind === "hours" ? `${v.toLocaleString("es-MX", { maximumFractionDigits: 1 })} h` : v.toLocaleString("es-MX", { maximumFractionDigits: 0 });

/** Escala "bonita": máximo redondeado y paso del eje. */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / step) * step, step };
}

const text = (x: number, y: number, s: string, opts: { size?: number; anchor?: string; fill?: string; weight?: string; rotate?: number } = {}) =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${opts.size ?? 12}" text-anchor="${opts.anchor ?? "start"}" fill="${opts.fill ?? INK}"${
    opts.weight ? ` font-weight="${opts.weight}"` : ""
  }${opts.rotate ? ` transform="rotate(${opts.rotate} ${x} ${y})"` : ""}>${esc(s)}</text>`;

function empty(w: number, h: number): string {
  return text(w / 2, h / 2, "Sin datos en este periodo", { anchor: "middle", fill: MUTED, size: 14 });
}

/** Contenido de la gráfica (sin la etiqueta <svg>) dentro de un lienzo de w × h. */
export function chartInner(chart: ChartData, w: number, h: number, withTitle = true): string {
  const n = chart.values.length;
  const titleH = withTitle ? 34 : 8;
  const head = withTitle ? text(w / 2, 22, clip(chart.title, Math.floor(w / 8.4)), { anchor: "middle", size: 15, weight: "bold" }) : "";
  if (!n || chart.values.every((v) => v === 0)) return head + empty(w, h);

  const k = chart.kind;
  const max = Math.max(...chart.values);

  if (chart.type === "pie") {
    // En ancho angosto (celular) la dona va arriba y la leyenda debajo, a lo ancho.
    const narrow = w < 560;
    const r = narrow ? Math.min(w / 2 - 28, 120) : Math.min(Math.min(w * 0.3, 230) - 20, (h - titleH) / 2 - 16);
    const cx = narrow ? w / 2 : Math.min(w * 0.3, 230);
    const cy = narrow ? titleH + r + 8 : titleH + (h - titleH) / 2;
    const total = chart.values.reduce((a, b) => a + Math.max(0, b), 0);
    let angle = -Math.PI / 2;
    let slices = "";
    chart.values.forEach((v, i) => {
      if (v <= 0) return;
      const a = (v / total) * Math.PI * 2;
      const color = PALETTE[i % PALETTE.length]!;
      if (a >= Math.PI * 2 - 1e-6) {
        slices += `<circle cx="${cx}" cy="${cy}" r="${(r * 0.8).toFixed(1)}" fill="none" stroke="${color}" stroke-width="${(r * 0.4).toFixed(1)}"/>`;
      } else {
        const [x1, y1] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
        const [x2, y2] = [cx + r * Math.cos(angle + a), cy + r * Math.sin(angle + a)];
        const ri = r * 0.6;
        const [x3, y3] = [cx + ri * Math.cos(angle + a), cy + ri * Math.sin(angle + a)];
        const [x4, y4] = [cx + ri * Math.cos(angle), cy + ri * Math.sin(angle)];
        const large = a > Math.PI ? 1 : 0;
        slices += `<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L${x3.toFixed(2)} ${y3.toFixed(2)} A${ri} ${ri} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
      }
      angle += a;
    });
    const center = text(cx, cy - 2, fmtVal(total, k), { anchor: "middle", size: 18, weight: "bold" }) + text(cx, cy + 16, "total", { anchor: "middle", size: 11, fill: MUTED });
    const lx = narrow ? 20 : cx + r + 40;
    const rowH = narrow ? 22 : Math.min(24, (h - titleH - 10) / n);
    const legendTop = narrow ? cy + r + 30 : titleH + 14;
    const legendChars = narrow ? Math.floor((w - lx - 28) / 6.6) - 12 : 30;
    const legend = chart.values
      .map((v, i) => {
        const y = legendTop + i * rowH;
        const pct = total ? Math.round((v / total) * 100) : 0;
        return (
          `<rect x="${lx}" y="${y - 10}" width="12" height="12" rx="2" fill="${PALETTE[i % PALETTE.length]}"/>` +
          text(lx + 20, y, `${clip(chart.categories[i]!, legendChars)} — ${fmtVal(v, k)} (${pct}%)`, { size: 12 })
        );
      })
      .join("");
    return head + slices + center + legend;
  }

  if (chart.type === "hbar") {
    const left = w < 560 ? Math.round(w * 0.36) : 190; // margen proporcional: en celular deja sitio a las barras
    const right = w < 560 ? 44 : 60;
    const labelChars = Math.floor((left - 12) / 6.4);
    const rowH = (h - titleH - 14) / n;
    const bh = Math.min(22, rowH * 0.7);
    const { top } = niceScale(max);
    const pw = w - left - right;
    const bars = chart.values
      .map((v, i) => {
        const y = titleH + i * rowH + (rowH - bh) / 2;
        const bw = (v / top) * pw;
        return (
          text(left - 8, y + bh / 2 + 4, clip(chart.categories[i]!, labelChars), { anchor: "end", size: 12 }) +
          `<rect x="${left}" y="${y.toFixed(1)}" width="${Math.max(bw, v > 0 ? 2 : 0).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${PALETTE[0]}"/>` +
          text(left + bw + 6, y + bh / 2 + 4, fmtVal(v, k), { size: 11, fill: MUTED })
        );
      })
      .join("");
    return head + `<line x1="${left}" y1="${titleH - 4}" x2="${left}" y2="${h - 10}" stroke="${GRID}"/>` + bars;
  }

  // bar / line: ejes con rejilla
  const narrow = w < 560;
  const left = 56;
  const right = narrow ? 12 : 20;
  const dense = n > (narrow ? 8 : 14); // etiquetas inclinadas cuando no caben rectas
  const bottom = dense ? 78 : 40;
  const pw = w - left - right;
  const ph = h - titleH - bottom;
  const { top, step } = niceScale(max);
  let grid = "";
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = titleH + ph - (v / top) * ph;
    grid += `<line x1="${left}" y1="${y.toFixed(1)}" x2="${w - right}" y2="${y.toFixed(1)}" stroke="${GRID}"/>` + text(left - 8, y + 4, fmtVal(v, k), { anchor: "end", size: 11, fill: MUTED });
  }
  const slot = pw / n;
  const labelEvery = n > 30 ? Math.ceil(n / 15) : narrow && n > 12 ? Math.ceil(n / 12) : 1;
  const xLabels = chart.categories
    .map((c, i) => {
      if (i % labelEvery) return "";
      const x = left + slot * i + slot / 2;
      const y = titleH + ph + 16;
      return dense ? text(x, y, clip(c, 14), { anchor: "end", size: 10, fill: MUTED, rotate: -45 }) : text(x, y, clip(c, 14), { anchor: "middle", size: 11, fill: MUTED });
    })
    .join("");
  const axis = `<line x1="${left}" y1="${titleH + ph}" x2="${w - right}" y2="${titleH + ph}" stroke="#94a3b8"/>`;
  const showValues = n <= (narrow ? 10 : 20);
  const yOf = (v: number) => titleH + ph - (v / top) * ph;

  if (chart.type === "line") {
    const pts = chart.values.map((v, i) => [left + slot * i + slot / 2, yOf(v)] as const);
    const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const area = `${path} L${pts[n - 1]![0].toFixed(1)} ${titleH + ph} L${pts[0]![0].toFixed(1)} ${titleH + ph} Z`;
    const dots = pts
      .map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${PALETTE[0]}" stroke="#fff" stroke-width="1.5"/>${showValues ? text(x, y - 9, fmtVal(chart.values[i]!, k), { anchor: "middle", size: 10, fill: MUTED }) : ""}`)
      .join("");
    return head + grid + axis + `<path d="${area}" fill="${PALETTE[0]}" opacity="0.10"/><path d="${path}" fill="none" stroke="${PALETTE[0]}" stroke-width="2.5" stroke-linejoin="round"/>` + dots + xLabels;
  }

  const bw = Math.max(2, slot * 0.7);
  const bars = chart.values
    .map((v, i) => {
      const x = left + slot * i + (slot - bw) / 2;
      const y = yOf(v);
      return (
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(titleH + ph - y, v > 0 ? 1.5 : 0).toFixed(1)}" rx="2" fill="${PALETTE[0]}"/>` +
        (showValues ? text(x + bw / 2, y - 5, fmtVal(v, k), { anchor: "middle", size: 10, fill: MUTED }) : "")
      );
    })
    .join("");
  return head + grid + axis + bars + xLabels;
}

/** Gráfica como documento SVG independiente (pantalla y conversión a PNG). */
export function renderChartSvg(chart: ChartData, width = 900, height?: number, withTitle = true): string {
  const narrow = width < 560;
  const n = chart.values.length;
  const h =
    height ??
    (chart.type === "hbar"
      ? Math.max(300, 60 + n * 30)
      : chart.type === "pie" && narrow
        ? 34 + 2 * 120 + 16 + 30 + n * 22 + 16 // dona arriba y leyenda debajo
        : narrow
          ? 340
          : 420);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${esc(chart.title)}">` +
    `<rect width="${width}" height="${h}" fill="#fff"/>${chartInner(chart, width, h, withTitle)}</svg>`
  );
}

/** Tarjeta completa del reporte (encabezado, indicadores y gráfica) para exportar como imagen. */
export function renderReportCardSvg(report: Report): string {
  const W = 1000;
  const pad = 32;
  let y = pad + 20;
  let body = text(pad, y, report.title, { size: 22, weight: "bold" });
  y += 8;
  for (const line of report.subtitle.slice(0, 3)) {
    y += 20;
    body += text(pad, y, clip(line, 120), { size: 12, fill: MUTED });
  }
  y += 22;

  const kpis = report.kpis.slice(0, 8);
  const cols = 4;
  const bw = (W - pad * 2 - 12 * (cols - 1)) / cols;
  kpis.forEach((kp, i) => {
    const x = pad + (i % cols) * (bw + 12);
    const yy = y + Math.floor(i / cols) * 70;
    body +=
      `<rect x="${x}" y="${yy}" width="${bw}" height="58" rx="8" fill="#f8fafc" stroke="${GRID}"/>` +
      text(x + 12, yy + 22, clip(kp.label, 30), { size: 11, fill: MUTED }) +
      text(x + 12, yy + 46, kp.value, { size: 20, weight: "bold" });
  });
  y += Math.ceil(kpis.length / cols) * 70 + 8;

  let chartH = 0;
  if (report.chart) {
    chartH = report.chart.type === "hbar" ? Math.max(320, 70 + report.chart.values.length * 30) : 420;
    body += `<g transform="translate(${pad},${y})">${chartInner(report.chart, W - pad * 2, chartH)}</g>`;
    y += chartH;
  }
  y += 28;
  body += text(W - pad, y, `Team Tracker · ${report.subtitle[3] ?? ""}`, { anchor: "end", size: 10, fill: MUTED });
  const H = y + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>`;
}
