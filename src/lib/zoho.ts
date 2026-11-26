import type { ZohoCfg } from "./config";
import { cleanErrorBody } from "./http";

// Endpoints usados (documentación oficial de Zoho Projects, rutas /restapi/):
//   GET /restapi/portal/{portal}/users/?user_type=all
//   GET /restapi/portal/{portal}/projects/
//   GET /restapi/portal/{portal}/projects/{project}/tasks/?index&range&status&last_modified_time&all_tasks
// Scopes del refresh token: ZohoProjects.portals.READ, ZohoProjects.projects.READ,
//   ZohoProjects.users.READ, ZohoProjects.tasks.READ
// No se consultan timesheets: no pude verificar su endpoint en la documentación.
//
// Todas las funciones reciben la configuración (`cfg`) para poder probar credenciales nuevas
// antes de guardarlas.

export const ZOHO_DCS = ["com", "eu", "in", "com.au", "jp"] as const;

const DCS: Record<string, { accounts: string; api: string }> = {
  com: { accounts: "https://accounts.zoho.com", api: "https://projectsapi.zoho.com" },
  eu: { accounts: "https://accounts.zoho.eu", api: "https://projectsapi.zoho.eu" },
  in: { accounts: "https://accounts.zoho.in", api: "https://projectsapi.zoho.in" },
  "com.au": { accounts: "https://accounts.zoho.com.au", api: "https://projectsapi.zoho.com.au" },
  jp: { accounts: "https://accounts.zoho.jp", api: "https://projectsapi.zoho.jp" },
};

function hosts(cfg: ZohoCfg) {
  const base = DCS[cfg.dc] ?? DCS.com!;
  return { accounts: cfg.accountsUrl ?? base.accounts, api: cfg.apiUrl ?? base.api };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// El token de acceso se reutiliza mientras no cambien las credenciales con que se obtuvo.
let cached: { key: string; token: string; expiresAt: number } | null = null;
const cacheKey = (cfg: ZohoCfg) => `${cfg.dc}|${cfg.clientId}|${cfg.refreshToken}`;

async function accessToken(cfg: ZohoCfg): Promise<string> {
  const key = cacheKey(cfg);
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: cfg.refreshToken ?? "",
    client_id: cfg.clientId ?? "",
    client_secret: cfg.clientSecret ?? "",
  });
  const res = await fetch(`${hosts(cfg).accounts}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) {
    throw new Error(`Zoho OAuth falló (${res.status}): ${j.error ?? "sin detalle"}. Revisa el data center y las credenciales.`);
  }
  cached = { key, token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function zget<T>(
  cfg: ZohoCfg,
  path: string,
  params: Record<string, string | number> = {},
  attempt = 0,
): Promise<T | null> {
  const url = new URL(`${hosts(cfg).api}/restapi/portal/${encodeURIComponent(cfg.portalId ?? "")}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken(cfg)}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  await sleep(200); // cortesía para no saturar la API
  if (res.status === 204) return null; // sin resultados
  if (res.status === 401 && attempt === 0) {
    cached = null;
    return zget<T>(cfg, path, params, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await sleep(5000 * (attempt + 1));
    return zget<T>(cfg, path, params, attempt + 1);
  }
  if (!res.ok) {
    const body = cleanErrorBody(await res.text());
    throw new Error(`Zoho ${res.status} en ${path}${body ? `: ${body}` : ""}`);
  }
  return (await res.json()) as T;
}

export type ZohoUser = { id: string; email: string; name: string; active: boolean };

export async function listZohoUsers(cfg: ZohoCfg): Promise<ZohoUser[]> {
  const j = await zget<{ users?: Array<{ id: string | number; email?: string; name?: string; active?: boolean }> }>(
    cfg,
    "/users/",
    { user_type: "all" },
  );
  return (j?.users ?? [])
    .filter((u) => u.email)
    .map((u) => ({
      id: String(u.id),
      email: u.email!.toLowerCase(),
      name: u.name ?? u.email!,
      active: u.active !== false,
    }));
}

export type ZohoProject = { id: string; name: string };

export async function listZohoProjects(cfg: ZohoCfg): Promise<ZohoProject[]> {
  const out: ZohoProject[] = [];
  for (let index = 1; index < 5000; index += 100) {
    const j = await zget<{ projects?: Array<{ id: string | number; name: string }> }>(cfg, "/projects/", {
      index,
      range: 100,
    });
    const batch = j?.projects ?? [];
    out.push(...batch.map((p) => ({ id: String(p.id), name: p.name })));
    if (batch.length < 100) break;
  }
  return out;
}

type RawTask = {
  id: string | number;
  id_string?: string;
  name: string;
  completed?: boolean;
  priority?: string;
  status?: { name?: string; type?: string };
  details?: { owners?: Array<{ id?: string | number; zpuid?: string | number; email?: string; name?: string }> };
  created_time_long?: number;
  last_updated_time_long?: number;
  completed_time_long?: number;
  end_date_long?: number;
  end_date?: string;
};

export type ZohoTaskData = {
  zohoId: string;
  name: string;
  status: string;
  completed: boolean;
  priority: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  completedAt: Date | null; // solo si Zoho lo informa
  dueDate: Date | null;
  owners: Array<{ id: string | null; zpuid: string | null; email: string | null }>;
};

const toDate = (ms?: number) => (typeof ms === "number" && ms > 0 ? new Date(ms) : null);

function parseTask(t: RawTask): ZohoTaskData {
  const completed = t.completed === true || t.status?.type === "closed";
  let dueDate = toDate(t.end_date_long);
  if (!dueDate && t.end_date && /^\d{2}-\d{2}-\d{4}$/.test(t.end_date)) {
    const [mm, dd, yyyy] = t.end_date.split("-");
    dueDate = new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
  }
  return {
    zohoId: String(t.id_string ?? t.id),
    name: t.name,
    status: t.status?.name ?? (completed ? "Completed" : "Open"),
    completed,
    priority: t.priority && t.priority.toLowerCase() !== "none" ? t.priority : null,
    createdAt: toDate(t.created_time_long),
    updatedAt: toDate(t.last_updated_time_long),
    completedAt: toDate(t.completed_time_long),
    dueDate,
    owners: (t.details?.owners ?? []).map((o) => ({
      id: o.id != null ? String(o.id) : null,
      zpuid: o.zpuid != null ? String(o.zpuid) : null,
      email: o.email ? o.email.toLowerCase() : null,
    })),
  };
}

/** Itera las tareas de un proyecto modificadas desde `sinceMs` (o todas si es undefined). */
export async function* listZohoTasks(cfg: ZohoCfg, projectId: string, sinceMs?: number): AsyncGenerator<ZohoTaskData> {
  for (let index = 1; index < 20_000; index += 100) {
    const params: Record<string, string | number> = {
      index,
      range: 100,
      status: "all",
      all_tasks: "true",
      sort_column: "last_modified_time",
      sort_order: "descending",
    };
    if (sinceMs) params.last_modified_time = sinceMs;
    const j = await zget<{ tasks?: RawTask[] }>(cfg, `/projects/${encodeURIComponent(projectId)}/tasks/`, params);
    const batch = j?.tasks ?? [];
    for (const t of batch) yield parseTask(t);
    if (batch.length < 100) break;
  }
}

export function zohoTaskUrl(cfg: ZohoCfg, projectId: string, taskId: string): string | null {
  if (!cfg.portalName) return null;
  const web = hosts(cfg).api.replace("projectsapi.", "projects.");
  return `${web}/portal/${encodeURIComponent(cfg.portalName)}#taskdetail/${projectId}/${taskId}`;
}

export async function checkZoho(cfg: ZohoCfg): Promise<{ ok: true; users: number } | { ok: false; error: string }> {
  try {
    const users = await listZohoUsers(cfg);
    return { ok: true, users: users.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
