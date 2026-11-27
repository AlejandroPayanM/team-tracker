"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

/**
 * Panel de configuración largo (p. ej. el armador de reportes).
 * Escritorio (≥ 1024 px): aparece tal cual, dentro de una tarjeta.
 * Celular y tablet: queda plegado en un botón con el resumen de lo elegido y, al tocarlo, abre una pantalla completa
 * con el formulario. Es el mismo formulario en ambos casos (solo cambia cómo se muestra), así que enviarlo recarga la
 * página con el resultado y la pantalla se cierra sola.
 */
export function FilterSheet({
  label,
  summary,
  title,
  children,
}: {
  label: string;
  /** Resumen de lo elegido, una línea por dato. */
  summary: string[];
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.body.dataset.sheetOpen = "1"; // el CSS oculta la barra inferior mientras la pantalla completa está abierta
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
      document.addEventListener("keydown", onKey);
      wasOpen.current = true;
      return () => {
        document.body.style.overflow = prev;
        delete document.body.dataset.sheetOpen;
        document.removeEventListener("keydown", onKey);
      };
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-left shadow-xs transition active:bg-slate-50 lg:hidden"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
          <Icon name="sliders" className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{label}</span>
          <span className="block truncate text-xs text-slate-500">{summary.join(" · ")}</span>
        </span>
        <Icon name="right" className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      <div
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={title}
        className={
          open
            ? "max-lg:fixed max-lg:inset-0 max-lg:z-[60] max-lg:m-0 max-lg:flex max-lg:animate-[sheet-up_.22s_ease-out] max-lg:flex-col max-lg:bg-white"
            : "max-lg:hidden"
        }
      >
        <div className="pt-safe-top flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 lg:hidden">
          <h2 className="flex-1 py-3.5 text-base font-semibold">{title}</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="-mr-2 rounded-lg p-2.5 text-slate-500 active:bg-slate-100">
            <Icon name="close" />
          </button>
        </div>
        <div className="max-lg:flex-1 max-lg:overflow-y-auto max-lg:overscroll-contain max-lg:px-4 max-lg:pt-4 lg:rounded-xl lg:border lg:border-slate-200 lg:bg-white lg:p-5 lg:shadow-xs">
          {children}
        </div>
      </div>
    </>
  );
}
