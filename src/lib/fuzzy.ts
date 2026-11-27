/**
 * Búsqueda "difusa" para los buscadores de las listas: sin importar mayúsculas ni acentos, por partes de palabras
 * ("alej" encuentra a Alejandro), en cualquier orden ("lopez ana" encuentra a Ana López) y tolerando una o dos
 * letras mal escritas ("alehandro", "plataforam"). Es una función pura, sin dependencias.
 */

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ@._/#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distancia de edición con tope: devuelve max+1 en cuanto se sabe que lo supera. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = cur[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (cur[j]! < rowMin) rowMin = cur[j]!;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** ¿Este fragmento de la búsqueda coincide con alguna palabra del texto (ya normalizado)? */
function tokenMatches(haystack: string, words: string[], token: string): boolean {
  if (haystack.includes(token)) return true;
  if (token.length < 3) return false; // con 1–2 letras solo cuenta la coincidencia exacta de arriba
  const tolerance = token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0;
  if (tolerance === 0) return false;
  for (const w of words) {
    // Contra la palabra completa y contra su inicio (quien aún está escribiendo: "alehan" ≈ "alejandro").
    if (editDistance(token, w, tolerance) <= tolerance) return true;
    if (w.length > token.length && editDistance(token, w.slice(0, token.length), tolerance) <= tolerance) return true;
  }
  return false;
}

/** Texto y búsqueda ya normalizados por `prepare`, para no repetir el trabajo en cada pulsación de tecla. */
export type Prepared = { text: string; words: string[] };
export const prepare = (s: string): Prepared => {
  const text = normalize(s);
  return { text, words: text.split(" ").filter(Boolean) };
};

export function fuzzyMatchPrepared(item: Prepared, tokens: string[]): boolean {
  return tokens.every((t) => tokenMatches(item.text, item.words, t));
}

export const queryTokens = (q: string): string[] => normalize(q).split(" ").filter(Boolean);

/** Atajo para uso puntual. Una búsqueda vacía coincide con todo. */
export function fuzzyMatch(text: string, query: string): boolean {
  const tokens = queryTokens(query);
  return tokens.length === 0 || fuzzyMatchPrepared(prepare(text), tokens);
}
