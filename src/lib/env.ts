// Lectura perezosa de variables de entorno (no rompe `next build` si faltan).
// La configuración de GitHub y Zoho NO se lee aquí: puede estar guardada en la app (cifrada),
// así que se obtiene con getConfig() de ./config, que usa las variables de entorno como respaldo.
const opt = (k: string) => process.env[k]?.trim() || undefined;

export const env = {
  get cronSecret() {
    return opt("CRON_SECRET");
  },
  get syncLookbackDays() {
    const n = Number(opt("SYNC_LOOKBACK_DAYS") ?? 120);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 730) : 120;
  },
};
