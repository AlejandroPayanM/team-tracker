import { db } from "./db";
import { decryptSecret, encryptSecret, encryptionAvailable, maskSecret } from "./secrets";

/** Ajustes que se pueden guardar desde la app. `env` es la variable de entorno equivalente (respaldo). */
export const SETTING_DEFS = {
  "github.token": { secret: true, env: "GITHUB_TOKEN", label: "Token de GitHub" },
  "github.org": { secret: false, env: "GITHUB_ORG", label: "Organización de GitHub" },
  "zoho.dc": { secret: false, env: "ZOHO_DC", label: "Data center de Zoho" },
  "zoho.clientId": { secret: false, env: "ZOHO_CLIENT_ID", label: "Client ID de Zoho" },
  "zoho.clientSecret": { secret: true, env: "ZOHO_CLIENT_SECRET", label: "Client Secret de Zoho" },
  "zoho.refreshToken": { secret: true, env: "ZOHO_REFRESH_TOKEN", label: "Refresh token de Zoho" },
  "zoho.portalId": { secret: false, env: "ZOHO_PORTAL_ID", label: "ID del portal de Zoho" },
  "zoho.portalName": { secret: false, env: "ZOHO_PORTAL_NAME", label: "Nombre del portal de Zoho" },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
export const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

export type StoredSettings = { values: Map<SettingKey, string>; unreadable: Set<SettingKey> };

/** Lee y descifra lo guardado en la app. Los secretos que no se pueden descifrar se reportan aparte. */
export async function loadStoredSettings(): Promise<StoredSettings> {
  const rows = await db.appSetting.findMany();
  const values = new Map<SettingKey, string>();
  const unreadable = new Set<SettingKey>();
  for (const r of rows) {
    const def = SETTING_DEFS[r.key as SettingKey];
    if (!def) continue; // ajuste desconocido: se ignora
    if (!def.secret) {
      values.set(r.key as SettingKey, r.value);
      continue;
    }
    try {
      values.set(r.key as SettingKey, decryptSecret(r.value, r.key));
    } catch {
      unreadable.add(r.key as SettingKey); // llave cambiada o dato alterado
    }
  }
  return { values, unreadable };
}

export async function saveSettings(entries: Partial<Record<SettingKey, string>>, by: string): Promise<void> {
  for (const [key, value] of Object.entries(entries) as [SettingKey, string][]) {
    const def = SETTING_DEFS[key];
    if (def.secret && !encryptionAvailable()) {
      throw new Error("Falta APP_ENCRYPTION_KEY: sin ella no se pueden guardar secretos en la app.");
    }
    const stored = def.secret ? encryptSecret(value, key) : value;
    await db.appSetting.upsert({
      where: { key },
      create: { key, value: stored, secret: def.secret, updatedBy: by },
      update: { value: stored, secret: def.secret, updatedBy: by },
    });
  }
}

export async function removeSettings(keys: SettingKey[]): Promise<void> {
  await db.appSetting.deleteMany({ where: { key: { in: keys } } });
}

export type SettingView = {
  key: SettingKey;
  label: string;
  secret: boolean;
  /** De dónde sale el valor que se está usando hoy. */
  source: "app" | "env" | "none" | "unreadable";
  /** Valor para mostrar: secretos enmascarados, el resto tal cual. Nunca el secreto completo. */
  display: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
};

/** Estado de cada ajuste para la pantalla de Integraciones (sin exponer secretos). */
export async function settingsOverview(): Promise<{ encryptionReady: boolean; items: Record<SettingKey, SettingView> }> {
  const [stored, rows] = await Promise.all([loadStoredSettings(), db.appSetting.findMany()]);
  const meta = new Map(rows.map((r) => [r.key, r]));
  const items = {} as Record<SettingKey, SettingView>;
  for (const key of SETTING_KEYS) {
    const def = SETTING_DEFS[key];
    const m = meta.get(key);
    const fromApp = stored.values.get(key);
    const fromEnv = process.env[def.env]?.trim() || undefined;
    const value = fromApp ?? fromEnv;
    items[key] = {
      key,
      label: def.label,
      secret: def.secret,
      source: stored.unreadable.has(key) && !fromEnv ? "unreadable" : fromApp !== undefined ? "app" : fromEnv ? "env" : "none",
      display: value === undefined ? null : def.secret ? maskSecret(value) : value,
      updatedAt: fromApp !== undefined ? (m?.updatedAt ?? null) : null,
      updatedBy: fromApp !== undefined ? (m?.updatedBy ?? null) : null,
    };
  }
  return { encryptionReady: encryptionAvailable(), items };
}
