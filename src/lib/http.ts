/**
 * Recorta el cuerpo de una respuesta de error para mostrarlo en la bitácora.
 * Las páginas HTML de error de proxies (502, 503…) no aportan nada y ensucian la tabla: se omiten.
 */
export function cleanErrorBody(text: string, max = 160): string {
  const t = text.trim();
  if (/^<(!doctype|html|head|body)/i.test(t) || /<html[\s>]/i.test(t)) return "";
  return t.replace(/\s+/g, " ").slice(0, max);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Rechaza peticiones de otro origen (defensa adicional a SameSite=Lax) en los endpoints que modifican o exportan datos. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // llamadas fuera del navegador no llevan la cookie de sesión de otro sitio
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

/** Ejecuta `fn` sobre cada elemento con a lo sumo `limit` tareas a la vez (sin saturar APIs ni la base). */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Espera entre reintentos de errores temporales. RETRY_DELAY_SCALE=0 los acelera en pruebas. */
export function retryDelays(): number[] {
  const scale = Number(process.env.RETRY_DELAY_SCALE ?? 1);
  return [2_000, 5_000, 10_000].map((ms) => ms * (Number.isFinite(scale) && scale >= 0 ? scale : 1));
}
