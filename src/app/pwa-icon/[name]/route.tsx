import { pwaIcon } from "@/lib/pwa-icon";

// Públicos a propósito (el manifiesto los pide sin sesión). Solo se sirven los tamaños de la lista.
const ICONS: Record<string, { size: number; maskable: boolean }> = {
  "192.png": { size: 192, maskable: false },
  "512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const spec = ICONS[(await params).name];
  if (!spec) return new Response("No encontrado", { status: 404 });
  const res = pwaIcon(spec.size, spec.maskable);
  res.headers.set("Cache-Control", "public, max-age=86400, immutable");
  return res;
}
