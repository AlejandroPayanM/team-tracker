import { db } from "./db";
import { getConfig } from "./config";
import { syncAll } from "./sync";

// Sincronización "bajo demanda": mientras haya alguien con la app abierta, el navegador pregunta cada pocos minutos si
// hay datos viejos y, si es así, se sincroniza solo lo modificado desde la última vez. Sin webhooks ni procesos en segundo plano.

/** Dentro de este margen desde el último intento no se vuelve a sincronizar sola. */
export const FRESH_MS = 4 * 60 * 1000;
/** El botón «Actualizar» tampoco dispara más de una sincronización cada tanto (protege los límites de GitHub/Zoho). */
export const FORCE_MIN_MS = 20 * 1000;
const RUNNING_MAX_MS = 10 * 60 * 1000;

export type SyncStatus = {
  /** Fin de la última sincronización que terminó bien (OK o con avisos). */
  lastOkAt: string | null;
  /** Fin del último intento real (omitidos no cuentan). */
  lastAttemptAt: string | null;
  /** El último intento terminó con error. */
  lastFailed: boolean;
  running: boolean;
};

export async function getSyncStatus(): Promise<SyncStatus> {
  const [ok, attempt, running] = await Promise.all([
    db.syncRun.findFirst({ where: { status: { in: ["OK", "WARNING"] }, finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    db.syncRun.findFirst({ where: { status: { in: ["OK", "WARNING", "ERROR"] }, finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true, status: true } }),
    db.syncRun.findFirst({ where: { status: "RUNNING", startedAt: { gt: new Date(Date.now() - RUNNING_MAX_MS) } }, select: { id: true } }),
  ]);
  return {
    lastOkAt: ok?.finishedAt?.toISOString() ?? null,
    lastAttemptAt: attempt?.finishedAt?.toISOString() ?? null,
    lastFailed: attempt?.status === "ERROR",
    running: Boolean(running),
  };
}

export type AutoSyncResult = {
  outcome: "ran" | "fresh" | "running" | "unconfigured";
  items: number;
  status: SyncStatus;
};

/** Sincroniza solo si hace falta. `force` (botón «Actualizar») baja el margen de frescura a unos segundos. */
export async function runAutoSync(force: boolean): Promise<AutoSyncResult> {
  const before = await getSyncStatus();
  if (before.running) return { outcome: "running", items: 0, status: before };

  const age = before.lastAttemptAt ? Date.now() - new Date(before.lastAttemptAt).getTime() : Infinity;
  if (age < (force ? FORCE_MIN_MS : FRESH_MS)) return { outcome: "fresh", items: 0, status: before };

  const cfg = await getConfig();
  if (!cfg.githubConfigured && !cfg.zohoConfigured) return { outcome: "unconfigured", items: 0, status: before };

  const results = await syncAll({ trigger: force ? "refresh" : "auto" });
  const items = results.reduce((a, r) => a + r.items, 0);

  // Las corridas automáticas sin cambios no se muestran en la bitácora; se podan las de más de 2 días.
  await db.syncRun.deleteMany({
    where: { trigger: "auto", status: "OK", items: 0, startedAt: { lt: new Date(Date.now() - 2 * 24 * 3600 * 1000) } },
  });
  return { outcome: "ran", items, status: await getSyncStatus() };
}
