"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type SyncStatus = { lastOkAt: string | null; lastAttemptAt: string | null; lastFailed: boolean; running: boolean };

const POLL_MS = 5 * 60 * 1000; // pregunta cada 5 min mientras la pestaña esté visible
const REFOCUS_MS = 2 * 60 * 1000; // al volver a la pestaña, si pasaron más de 2 min

function ago(iso: string | null, now: number): string {
  if (!iso) return "sin sincronizar";
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "hace unos segundos";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/**
 * Barra de actualización que aparece en todas las pantallas: sincroniza sola al abrir y cada pocos minutos
 * (solo si hay datos viejos; el servidor decide) y tiene un botón para actualizar al momento.
 */
export function SyncBar({ initial }: { initial: SyncStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const knownOk = useRef(initial.lastOkAt);
  const inFlight = useRef(false);
  const lastTick = useRef(0);

  const tick = useCallback(
    async (force: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      lastTick.current = Date.now();
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/sync/tick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        });
        if (!res.ok) throw new Error(res.status === 401 ? "Tu sesión expiró" : `No se pudo actualizar (${res.status})`);
        const j = (await res.json()) as { status: SyncStatus };
        setStatus(j.status);
        // Se recargan los datos de la pantalla si hubo una sincronización nueva (propia o de otra pestaña/usuario).
        if (force || j.status.lastOkAt !== knownOk.current) {
          knownOk.current = j.status.lastOkAt;
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo actualizar");
      } finally {
        inFlight.current = false;
        setBusy(false);
        setNow(Date.now());
      }
    },
    [router],
  );

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const first = setTimeout(() => visible() && void tick(false), 1500);
    const poll = setInterval(() => visible() && void tick(false), POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => {
      if (visible() && Date.now() - lastTick.current > REFOCUS_MS) void tick(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tick]);

  const working = busy || status.running;
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500" aria-live="polite">
      <span
        className={`inline-block h-2 w-2 rounded-full ${working ? "animate-pulse bg-sky-500" : error || status.lastFailed ? "bg-amber-500" : "bg-emerald-500"}`}
        aria-hidden
      />
      <span>
        {working ? "Sincronizando…" : error ? error : `Datos: ${ago(status.lastOkAt, now)}`}
        {!working && !error && status.lastFailed && <span className="text-amber-700"> · último intento con error</span>}
      </span>
      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={busy} onClick={() => void tick(true)} title="Traer ahora lo que haya cambiado">
        ↻ Actualizar
      </button>
    </div>
  );
}
