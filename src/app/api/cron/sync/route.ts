import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { syncAll } from "@/lib/sync";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = env.cronSecret;
  if (!secret || secret.length < 16) return false; // desactivado si no hay secreto fuerte
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await syncAll({ trigger: "cron" });
  await audit("sync.cron", { userId: null, userEmail: "cron", detail: JSON.stringify(results).slice(0, 400) });
  return NextResponse.json({ results });
}

export const GET = handle;
export const POST = handle;
