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

/** Espera entre reintentos de errores temporales. RETRY_DELAY_SCALE=0 los acelera en pruebas. */
export function retryDelays(): number[] {
  const scale = Number(process.env.RETRY_DELAY_SCALE ?? 1);
  return [2_000, 5_000, 10_000].map((ms) => ms * (Number.isFinite(scale) && scale >= 0 ? scale : 1));
}
