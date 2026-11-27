"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

const Ctx = createContext<{ close: () => void } | null>(null);
/** Dentro de un diálogo: permite cerrarlo (p. ej. cuando una acción termina bien). */
export const useDialog = () => useContext(Ctx);

/**
 * Botón que abre una ventana modal (<dialog> nativo: Esc cierra, el foco queda atrapado y el fondo no se mueve).
 * El contenido solo existe mientras está abierta, así cada vez que se abre los formularios empiezan limpios.
 */
export function Dialog({
  label,
  title,
  description,
  triggerClassName = "btn-ghost btn-sm",
  children,
}: {
  label: React.ReactNode;
  title: string;
  description?: string;
  triggerClassName?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (open && el && !el.open) el.showModal();
  }, [open]);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {label}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close(); // clic en el fondo oscuro
        }}
        className="m-auto max-h-[92dvh] w-[min(34rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50 max-sm:mx-0 max-sm:mb-0 max-sm:mt-auto max-sm:w-full max-sm:max-w-none max-sm:animate-[sheet-up_.22s_ease-out] max-sm:rounded-b-none"
      >
        {open && (
          <Ctx.Provider value={{ close: () => ref.current?.close() }}>
            <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-100 bg-white px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">{title}</h2>
                {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => ref.current?.close()}
                className="-mr-2 ml-auto shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="pb-safe space-y-4 p-5">{children}</div>
          </Ctx.Provider>
        )}
      </dialog>
    </>
  );
}
