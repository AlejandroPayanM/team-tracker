import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { runAutoSync } from "@/lib/autosync";
import { sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({ force: z.boolean().optional() });

/**
 * El navegador la llama al abrir la app, cada pocos minutos y con el botón «Actualizar».
 * Si los datos ya están frescos responde de inmediato; si no, sincroniza solo lo modificado.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "origen no permitido" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  const force = parsed.success && parsed.data.force === true;

  const result = await runAutoSync(force);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
