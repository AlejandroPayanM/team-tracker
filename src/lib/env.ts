// Lectura perezosa de variables de entorno (no rompe `next build` si faltan).
const opt = (k: string) => process.env[k]?.trim() || undefined;

export const env = {
  get githubToken() {
    return opt("GITHUB_TOKEN");
  },
  get githubOrg() {
    return opt("GITHUB_ORG");
  },
  get zohoDc() {
    return opt("ZOHO_DC") ?? "com";
  },
  // Para data centers no incluidos en la tabla de zoho.ts (ej. https://accounts.zoho.xx)
  get zohoAccountsUrl() {
    return opt("ZOHO_ACCOUNTS_URL");
  },
  get zohoApiUrl() {
    return opt("ZOHO_API_URL");
  },
  get zohoClientId() {
    return opt("ZOHO_CLIENT_ID");
  },
  get zohoClientSecret() {
    return opt("ZOHO_CLIENT_SECRET");
  },
  get zohoRefreshToken() {
    return opt("ZOHO_REFRESH_TOKEN");
  },
  get zohoPortalId() {
    return opt("ZOHO_PORTAL_ID");
  },
  get zohoPortalName() {
    return opt("ZOHO_PORTAL_NAME");
  },
  get cronSecret() {
    return opt("CRON_SECRET");
  },
  get syncLookbackDays() {
    const n = Number(opt("SYNC_LOOKBACK_DAYS") ?? 120);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 730) : 120;
  },
  get githubConfigured() {
    return Boolean(this.githubToken);
  },
  get zohoConfigured() {
    return Boolean(
      this.zohoClientId && this.zohoClientSecret && this.zohoRefreshToken && this.zohoPortalId,
    );
  },
};
