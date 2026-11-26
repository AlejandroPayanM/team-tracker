"use client";

import { Icon } from "@/components/icons";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-700">
        <Icon name="alert" className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">No se pudo cargar esta pantalla</h1>
      <p className="mt-1 text-sm text-slate-500">
        Puede ser un problema temporal de conexión. Inténtalo de nuevo; si sigue igual, revisa más tarde.
      </p>
      {error.digest && <p className="mt-2 text-xs text-slate-400">Referencia: {error.digest}</p>}
      <button type="button" onClick={reset} className="btn mt-5">
        <Icon name="refresh" className="h-4 w-4" />
        Reintentar
      </button>
    </div>
  );
}
