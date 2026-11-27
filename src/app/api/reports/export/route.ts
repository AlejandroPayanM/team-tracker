import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { scopeFor } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { sameOrigin } from "@/lib/http";
import { buildReport } from "@/lib/reports/build";
import { buildPdf } from "@/lib/reports/export-pdf";
import { buildXlsx } from "@/lib/reports/export-xlsx";
import { decodeChartPng, exportBodySchema, parseSpec, queryToRaw } from "@/lib/reports/spec";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "origen no permitido" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "cambia tu contraseña primero" }, { status: 403 });
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ error: "se espera JSON" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = exportBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "solicitud inválida" }, { status: 400 });
  const { format, query, chartPng } = parsed.data;

  // Todo se recalcula en el servidor a partir de los filtros: lo único que viene del navegador es la imagen.
  const spec = parseSpec(queryToRaw(query));
  const report = await buildReport(spec, (await scopeFor(user)).where);
  const png = report.chart ? decodeChartPng(chartPng) : null;

  const file = format === "xlsx" ? await buildXlsx(report, png) : await buildPdf(report, png);
  await audit("report.export", {
    detail: `${format} · por ${spec.group} · ${report.rows.length} filas · ${spec.range.weeks} sem.`,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": MIME[format],
      "Content-Disposition": `attachment; filename="reporte-${spec.group}-${stamp}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
