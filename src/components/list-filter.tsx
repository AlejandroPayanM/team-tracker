"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SearchBox } from "@/components/search-box";
import { fuzzyMatchPrepared, prepare, queryTokens } from "@/lib/fuzzy";

/**
 * Buscador para listas y tablas que ya vienen armadas desde el servidor. Marca en el contenido:
 *   - `data-search="texto"` en cada elemento filtrable (fila, tarjeta…): se muestra si el texto coincide.
 *   - `data-search-group="texto"` en un contenedor de varios elementos (p. ej. un líder con sus equipos): si el texto
 *     del grupo coincide se muestra completo; si no, solo los elementos que coincidan, y se oculta si no queda ninguno.
 *     Un grupo con texto vacío solo se muestra cuando algún elemento suyo coincide.
 * Todo ocurre en el navegador; los datos no se vuelven a pedir.
 */
export function ListFilter({
  placeholder,
  noun,
  children,
  className = "space-y-5",
}: {
  placeholder: string;
  /** Lo que se cuenta, en plural: «personas», «equipos»… */
  noun: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [count, setCount] = useState<{ shown: number; total: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const apply = useCallback(() => {
    const root = box.current;
    if (!root) return;
    const tokens = queryTokens(q);
    const setHidden = (el: Element, hide: boolean) => (hide ? el.setAttribute("data-search-hidden", "") : el.removeAttribute("data-search-hidden"));
    const items = [...root.querySelectorAll<HTMLElement>("[data-search]")];
    const groups = [...root.querySelectorAll<HTMLElement>("[data-search-group]")];

    if (tokens.length === 0) {
      for (const el of [...items, ...groups]) setHidden(el, false);
      setCount({ shown: items.length, total: items.length });
      return;
    }

    const matches = (text: string) => fuzzyMatchPrepared(prepare(text), tokens);
    const inGroup = new Set<HTMLElement>();
    for (const g of groups) {
      const groupHit = matches(g.dataset.searchGroup ?? "");
      let any = false;
      for (const item of g.querySelectorAll<HTMLElement>("[data-search]")) {
        inGroup.add(item);
        const show = groupHit || matches(item.dataset.search ?? "");
        setHidden(item, !show);
        any ||= show;
      }
      setHidden(g, !(groupHit || any));
    }
    let shown = 0;
    for (const item of items) {
      if (!inGroup.has(item)) setHidden(item, !matches(item.dataset.search ?? ""));
      if (!item.hasAttribute("data-search-hidden")) shown++;
    }
    setCount({ shown, total: items.length });
  }, [q]);

  useEffect(() => {
    apply();
    const root = box.current;
    if (!root) return;
    // Si el servidor refresca la lista (p. ej. tras sincronizar), la búsqueda se vuelve a aplicar.
    const obs = new MutationObserver(apply);
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [apply]);

  const searching = q.trim() !== "";
  return (
    <div className={className}>
      <SearchBox
        value={q}
        onChange={setQ}
        placeholder={placeholder}
        status={count && (searching ? `${count.shown} de ${count.total} ${noun}` : undefined)}
      />
      <div ref={box} className={className}>
        {children}
      </div>
      {searching && count?.shown === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          Ningún resultado para «{q.trim()}». <button type="button" className="font-medium text-indigo-600 hover:underline" onClick={() => setQ("")}>Limpiar búsqueda</button>
        </p>
      )}
    </div>
  );
}
