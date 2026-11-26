import { loadStoredSettings, type SettingKey } from "./settings";

// Configuración efectiva de las integraciones: lo guardado en la app (cifrado) tiene prioridad;
// si no hay, se usan las variables de entorno. Se cachea unos segundos para no consultar la base
// en cada petición a GitHub/Zoho.

export type GithubCfg = { token?: string; org?: string };
export type ZohoCfg = {
  dc: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  portalId?: string;
  portalName?: string;
  accountsUrl?: string; // solo por variable de entorno (data centers no incluidos en la tabla)
  apiUrl?: string;
};
export type IntegrationConfig = {
  github: GithubCfg;
  zoho: ZohoCfg;
  githubConfigured: boolean;
  zohoConfigured: boolean;
};

const TTL_MS = 15_000;
let cache: { at: number; value: IntegrationConfig } | null = null;

const opt = (k: string) => process.env[k]?.trim() || undefined;

export function buildConfig(stored: Map<SettingKey, string>): IntegrationConfig {
  const pick = (key: SettingKey, envName: string) => stored.get(key) || opt(envName);
  const github: GithubCfg = { token: pick("github.token", "GITHUB_TOKEN"), org: pick("github.org", "GITHUB_ORG") };
  const zoho: ZohoCfg = {
    dc: pick("zoho.dc", "ZOHO_DC") ?? "com",
    clientId: pick("zoho.clientId", "ZOHO_CLIENT_ID"),
    clientSecret: pick("zoho.clientSecret", "ZOHO_CLIENT_SECRET"),
    refreshToken: pick("zoho.refreshToken", "ZOHO_REFRESH_TOKEN"),
    portalId: pick("zoho.portalId", "ZOHO_PORTAL_ID"),
    portalName: pick("zoho.portalName", "ZOHO_PORTAL_NAME"),
    accountsUrl: opt("ZOHO_ACCOUNTS_URL"),
    apiUrl: opt("ZOHO_API_URL"),
  };
  return {
    github,
    zoho,
    githubConfigured: Boolean(github.token),
    zohoConfigured: Boolean(zoho.clientId && zoho.clientSecret && zoho.refreshToken && zoho.portalId),
  };
}

export async function getConfig(): Promise<IntegrationConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const { values } = await loadStoredSettings();
  const value = buildConfig(values);
  cache = { at: Date.now(), value };
  return value;
}

/** Descarta el caché (se llama al guardar o quitar credenciales). */
export function invalidateConfig(): void {
  cache = null;
}
