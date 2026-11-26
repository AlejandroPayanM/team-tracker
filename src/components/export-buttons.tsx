"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

type Format = "xlsx" | "pdf" | "png";

/** Dibuja un SVG en un canvas (escala 2 para que se vea nítido). Todo ocurre en el navegador. */
async function svgToCanvas(svg: string, scale = 2): Promise<HTMLCanvasElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("No se pudo dibujar la gráfica."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const w = img.naturalWidth || 900;
  const h = img.naturalHeight || 420;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no permite crear la imagen.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportButtons({
  query,
  chartSvg,
  cardSvg,
}: {
  /** Mismos parámetros que la URL del reporte; el servidor recalcula todo con ellos. */
  query: string;
  chartSvg: string | null;
  cardSvg: string;
}) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(format: Format) {
    setBusy(format);
    setError(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "png") {
        const canvas = await svgToCanvas(cardSvg, 2);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
        if (!blob) throw new Error("No se pudo generar la imagen.");
        download(blob, `reporte-${stamp}.png`);
        return;
      }
      // Excel y PDF los arma el servidor; la gráfica viaja como PNG para incrustarla.
      const chartPng = chartSvg ? (await svgToCanvas(chartSvg, 2)).toDataURL("image/png") : undefined;
      const res = await fetch("/api/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, query, chartPng }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? "Tu sesión expiró. Vuelve a iniciar sesión." : `No se pudo generar el archivo (${res.status}).`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `reporte-${stamp}.${format}`;
      download(await res.blob(), name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ocurrió un error al exportar.");
    } finally {
      setBusy(null);
    }
  }

  const btn = "btn-ghost disabled:cursor-wait";
  const item = (format: Format, label: string) => (
    <button type="button" className={btn} disabled={busy !== null} onClick={() => run(format)}>
      <Icon name="download" className="h-4 w-4 shrink-0" />
      {busy === format ? "Generando…" : label}
    </button>
  );
  return (
    <div className="no-print space-y-2 xl:shrink-0">
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <span className="col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-1 sm:mr-1 sm:text-sm sm:font-medium sm:normal-case sm:tracking-normal">
          Exportar
        </span>
        {item("xlsx", "Excel")}
        {item("pdf", "PDF")}
        {item("png", "Imagen")}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
