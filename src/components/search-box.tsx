"use client";

import { Icon } from "@/components/icons";

/**
 * Campo de búsqueda: filtra al escribir, tiene botón para limpiar (y Esc) y nunca envía el formulario donde esté
 * (Enter no hace nada). Es solo la interfaz; quien lo usa decide cómo filtrar.
 */
export function SearchBox({
  value,
  onChange,
  placeholder = "Buscar…",
  label,
  status,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Texto para lectores de pantalla (por defecto, el placeholder). */
  label?: string;
  /** Resultado de la búsqueda, p. ej. «3 de 12 personas». */
  status?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
            if (e.key === "Escape" && value) {
              e.preventDefault();
              onChange("");
            }
          }}
          placeholder={placeholder}
          aria-label={label ?? placeholder}
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="input pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Limpiar búsqueda"
            className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        )}
      </div>
      {status && (
        <p className="mt-1 px-1 text-xs text-slate-500" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}
