"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getConfig, invalidateConfig } from "@/lib/config";
import { SETTING_DEFS, loadStoredSettings, removeSettings, saveSettings, type SettingKey } from "@/lib/settings";
import { encryptionAvailable } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import {
  clientIp,
  createSession,
  destroySession,
  getCurrentUser,
  hashPassword,
  requireAdmin,
  requireUser,
  revokeOtherSessions,
  verifyLogin,
} from "@/lib/auth";
import {
  firstError,
  githubCredsSchema,
  loginSchema,
  memberSchema,
  noteSchema,
  zohoCredsSchema,
} from "@/lib/validation";
import { checkGithub, resolveGithubLogin } from "@/lib/github";
import { checkZoho } from "@/lib/zoho";
import { syncAll } from "@/lib/sync";

export type FormState = { error?: string; ok?: string };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

// ───────── Sesión ─────────

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: str(fd, "email"), password: str(fd, "password") });
  if (!parsed.success) return { error: "Correo o contraseña incorrectos." };
  const ip = await clientIp();
  const result = await verifyLogin(parsed.data.email, parsed.data.password, ip);
  if (!result.ok) {
    await audit("auth.login_failed", { userId: null, userEmail: parsed.data.email });
    return { error: result.error };
  }
  await createSession(result.userId, ip);
  await audit("auth.login", { userId: result.userId, userEmail: parsed.data.email });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit("auth.logout", { userId: user.id, userEmail: user.email });
  redirect("/login");
}

export async function changePasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = str(fd, "current");
  const next = str(fd, "next");
  if (next.length < 12) return { error: "La nueva contraseña debe tener al menos 12 caracteres." };
  if (next.length > 200) return { error: "La nueva contraseña es demasiado larga." };
  if (next !== str(fd, "confirm")) return { error: "Las contraseñas nuevas no coinciden." };
  if (next === current) return { error: "La nueva contraseña debe ser distinta a la actual." };

  // verifyLogin aplica el límite de intentos y registra los fallos, igual que el login.
  const check = await verifyLogin(user.email, current, await clientIp());
  if (!check.ok) {
    return { error: check.error.startsWith("Correo o contraseña") ? "La contraseña actual es incorrecta." : check.error };
  }
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  await revokeOtherSessions(user.id);
  await audit("auth.password_change", { userId: user.id, userEmail: user.email });
  return { ok: "Contraseña actualizada." };
}

// ───────── Compañeros ─────────

function parseMember(fd: FormData) {
  return memberSchema.safeParse({
    name: str(fd, "name"),
    email: str(fd, "email"),
    githubLogin: str(fd, "githubLogin"),
    zohoEmail: str(fd, "zohoEmail"),
    position: str(fd, "position"),
  });
}

function uniqueMessage(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return "Ya existe un compañero con ese correo o usuario de GitHub.";
  }
  return null;
}

export async function createMemberAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = parseMember(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const d = parsed.data;

  let githubLogin = d.githubLogin ?? null;
  if (!githubLogin && (await getConfig()).githubConfigured) {
    githubLogin = await resolveGithubLogin(d.email).catch(() => null);
  }

  let id: string;
  try {
    const m = await db.member.create({
      data: {
        name: d.name,
        email: d.email,
        githubLogin,
        zohoEmail: d.zohoEmail ?? null,
        position: d.position ?? null,
      },
    });
    id = m.id;
  } catch (e) {
    const msg = uniqueMessage(e);
    if (msg) return { error: msg };
    throw e;
  }
  await audit("member.create", { target: id, detail: `${d.name} <${d.email}> gh:${githubLogin ?? "-"}` });
  // Trae su historial en segundo plano. La persona nueva queda "pendiente" (sin cursor), así que
  // aunque este intento se omita por otra sincronización en curso, la siguiente lo completa.
  after(async () => {
    await syncAll({ trigger: "member-added" }).catch((e) => console.error("backfill failed", e));
  });
  revalidatePath("/team");
  redirect(`/team/${id}`);
}

export async function updateMemberAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = str(fd, "id");
  const parsed = parseMember(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const d = parsed.data;
  const before = await db.member.findUnique({ where: { id } });
  if (!before) return { error: "Compañero no encontrado." };
  const githubChanged = before.githubLogin !== (d.githubLogin ?? null);
  const zohoRelink = before.email !== d.email || before.zohoEmail !== (d.zohoEmail ?? null);
  try {
    await db.member.update({
      where: { id },
      data: {
        name: d.name,
        email: d.email,
        githubLogin: d.githubLogin ?? null,
        zohoEmail: d.zohoEmail ?? null,
        position: d.position ?? null,
        // Si cambia el usuario de GitHub o el correo, se vuelve a ligar y a traer su historial.
        ...(githubChanged ? { githubSyncedAt: null } : {}),
        ...(zohoRelink ? { zohoUserId: null, zohoSyncedAt: null } : {}),
      },
    });
  } catch (e) {
    const msg = uniqueMessage(e);
    if (msg) return { error: msg };
    throw e;
  }
  await audit("member.update", { target: id, detail: d.name });
  if ((githubChanged && d.githubLogin) || zohoRelink) {
    after(async () => {
      await syncAll({ trigger: "member-updated" }).catch((e) => console.error("backfill failed", e));
    });
  }
  revalidatePath(`/team/${id}`);
  revalidatePath("/team");
  return { ok: "Cambios guardados." };
}

export async function archiveMemberAction(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = str(fd, "id");
  const m = await db.member.update({ where: { id }, data: { archivedAt: new Date() } });
  await audit("member.archive", { target: id, detail: m.email });
  revalidatePath("/", "layout");
  redirect("/team");
}

export async function restoreMemberAction(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = str(fd, "id");
  // Mientras estuvo archivado no se sincronizó: Zoho vuelve a traer su historial y el cursor de
  // GitHub (que quedó viejo) ya cubre el hueco con el periodo máximo configurado.
  const m = await db.member.update({ where: { id }, data: { archivedAt: null, zohoSyncedAt: null } });
  await audit("member.restore", { target: id, detail: m.email });
  after(async () => {
    await syncAll({ trigger: "member-restored" }).catch((e) => console.error("backfill failed", e));
  });
  revalidatePath("/", "layout");
  redirect(`/team/${id}`);
}

/** Borrado definitivo: solo para archivados y escribiendo su correo para confirmar. */
export async function deleteMemberAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = str(fd, "id");
  const m = await db.member.findUnique({ where: { id } });
  if (!m) return { error: "Compañero no encontrado." };
  if (!m.archivedAt) return { error: "Primero archívalo." };
  if (str(fd, "confirm").trim().toLowerCase() !== m.email) return { error: "El correo de confirmación no coincide." };
  await db.member.delete({ where: { id } });
  await audit("member.delete", { target: id, detail: `${m.name} <${m.email}>` });
  revalidatePath("/", "layout");
  redirect("/team");
}

// ───────── Notas y acuerdos ─────────

export async function addNoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = noteSchema.safeParse({
    memberId: str(fd, "memberId"),
    kind: str(fd, "kind"),
    body: str(fd, "body"),
    dueDate: str(fd, "dueDate"),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const d = parsed.data;
  if (!(await db.member.findUnique({ where: { id: d.memberId }, select: { id: true } }))) {
    return { error: "Compañero no encontrado." };
  }
  await db.memberNote.create({
    data: { memberId: d.memberId, authorId: user.id, kind: d.kind, body: d.body, dueDate: d.dueDate ?? null },
  });
  revalidatePath(`/team/${d.memberId}`);
  return { ok: "Guardado." };
}

export async function toggleNoteAction(fd: FormData): Promise<void> {
  await requireAdmin();
  const n = await db.memberNote.findUnique({ where: { id: str(fd, "id") } });
  if (!n) return;
  await db.memberNote.update({ where: { id: n.id }, data: { done: !n.done } });
  revalidatePath(`/team/${n.memberId}`);
}

export async function deleteNoteAction(fd: FormData): Promise<void> {
  await requireAdmin();
  const n = await db.memberNote.findUnique({ where: { id: str(fd, "id") } });
  if (!n) return;
  await db.memberNote.delete({ where: { id: n.id } });
  revalidatePath(`/team/${n.memberId}`);
}

// ───────── Integraciones ─────────

export async function syncNowAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const full = fd.get("full") === "on";
  const results = await syncAll({ full, trigger: "manual", deep: true });
  await audit("sync.manual", { detail: `${full ? "full " : ""}${JSON.stringify(results)}`.slice(0, 400) });
  revalidatePath("/", "layout");
  const text = results
    .map((r) => {
      if (r.status === "OK") return `${r.source}: ${r.items} elementos`;
      if (r.status === "WARNING") return `${r.source}: ${r.items} elementos, con avisos (${r.message ?? ""})`;
      return `${r.source}: ${r.message ?? r.status}`;
    })
    .join(" · ");
  return results.some((r) => r.status === "ERROR") ? { error: text } : { ok: text };
}

export async function testConnectionsAction(_prev: FormState): Promise<FormState> {
  await requireAdmin();
  invalidateConfig();
  const cfg = await getConfig();
  const parts: string[] = [];
  let failed = false;
  if (cfg.githubConfigured) {
    const r = await checkGithub();
    parts.push(r.ok ? `GitHub OK (token de ${r.login})` : `GitHub: ${r.error}`);
    failed ||= !r.ok;
  } else parts.push("GitHub: sin configurar");
  if (cfg.zohoConfigured) {
    const r = await checkZoho(cfg.zoho);
    parts.push(r.ok ? `Zoho OK (${r.users} usuarios en el portal)` : `Zoho: ${r.error}`);
    failed ||= !r.ok;
  } else parts.push("Zoho: sin configurar");
  return failed ? { error: parts.join(" · ") } : { ok: parts.join(" · ") };
}

// ───────── Credenciales guardadas en la app ─────────

const NO_KEY_MSG =
  "Para guardar secretos en la app primero define la variable APP_ENCRYPTION_KEY (≥ 32 caracteres aleatorios) en Vercel y redespliega.";

const GROUPS: Record<"github" | "zoho", SettingKey[]> = {
  github: ["github.token", "github.org"],
  zoho: ["zoho.dc", "zoho.clientId", "zoho.clientSecret", "zoho.refreshToken", "zoho.portalId", "zoho.portalName"],
};

/** Guarda lo que cambió: secretos solo si se escribió uno nuevo; no secretos si difieren del valor efectivo. */
async function applyChanges(
  incoming: Partial<Record<SettingKey, string>>,
  effective: Partial<Record<SettingKey, string | undefined>>,
  stored: Set<SettingKey>,
  by: string,
): Promise<{ saved: SettingKey[]; removed: SettingKey[] }> {
  const toSave: Partial<Record<SettingKey, string>> = {};
  const toRemove: SettingKey[] = [];
  for (const [k, v] of Object.entries(incoming) as [SettingKey, string][]) {
    if (SETTING_DEFS[k].secret) {
      if (v) toSave[k] = v; // vacío = no cambiar
    } else if (v === "") {
      if (stored.has(k)) toRemove.push(k); // vacío = quitar lo guardado (vuelve a la variable de entorno)
    } else if (v !== effective[k]) {
      toSave[k] = v;
    }
  }
  await saveSettings(toSave, by);
  await removeSettings(toRemove);
  invalidateConfig();
  return { saved: Object.keys(toSave) as SettingKey[], removed: toRemove };
}

export async function saveGithubCredentialsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = githubCredsSchema.safeParse({ token: str(fd, "token"), org: str(fd, "org") });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { token, org } = parsed.data;
  if (token && !encryptionAvailable()) return { error: NO_KEY_MSG };

  let note = "";
  if (token && fd.get("skipTest") !== "on") {
    const r = await checkGithub(token); // se prueba ANTES de guardar
    if (!r.ok) return { error: `El token no funciona: ${r.error}. No se guardó nada.` };
    note = ` Token válido (cuenta ${r.login}).`;
  }

  invalidateConfig();
  const [cfg, storedNow] = await Promise.all([getConfig(), loadStoredSettings()]);
  const { saved, removed } = await applyChanges(
    { "github.token": token, "github.org": org },
    { "github.org": cfg.github.org },
    new Set(storedNow.values.keys()),
    user.email,
  );
  // Solo se registran los nombres de los ajustes, nunca sus valores.
  await audit("settings.github", { detail: `guardó: ${saved.join(", ") || "—"}; quitó: ${removed.join(", ") || "—"}` });
  revalidatePath("/settings");
  return saved.length || removed.length ? { ok: `Guardado.${note}` } : { ok: "No había cambios que guardar." };
}

export async function saveZohoCredentialsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = zohoCredsSchema.safeParse({
    dc: str(fd, "dc"),
    clientId: str(fd, "clientId"),
    clientSecret: str(fd, "clientSecret"),
    refreshToken: str(fd, "refreshToken"),
    portalId: str(fd, "portalId"),
    portalName: str(fd, "portalName"),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const d = parsed.data;
  if ((d.clientSecret || d.refreshToken) && !encryptionAvailable()) return { error: NO_KEY_MSG };

  invalidateConfig();
  const [cfg, storedNow] = await Promise.all([getConfig(), loadStoredSettings()]);

  // Configuración resultante = la actual + lo nuevo. Si queda completa, se prueba antes de guardar.
  const candidate = {
    ...cfg.zoho,
    dc: d.dc,
    clientId: d.clientId || undefined,
    clientSecret: d.clientSecret || cfg.zoho.clientSecret,
    refreshToken: d.refreshToken || cfg.zoho.refreshToken,
    portalId: d.portalId || undefined,
    portalName: d.portalName || undefined,
  };
  const complete = Boolean(candidate.clientId && candidate.clientSecret && candidate.refreshToken && candidate.portalId);
  let note = "";
  if (complete && fd.get("skipTest") !== "on") {
    const r = await checkZoho(candidate);
    if (!r.ok) return { error: `Zoho no respondió con esos datos: ${r.error}. No se guardó nada.` };
    note = ` Conexión válida (${r.users} usuarios en el portal).`;
  } else if (!complete) {
    note = " Faltan campos para poder conectar con Zoho.";
  }

  const { saved, removed } = await applyChanges(
    {
      "zoho.dc": d.dc,
      "zoho.clientId": d.clientId,
      "zoho.clientSecret": d.clientSecret,
      "zoho.refreshToken": d.refreshToken,
      "zoho.portalId": d.portalId,
      "zoho.portalName": d.portalName,
    },
    {
      "zoho.dc": cfg.zoho.dc,
      "zoho.clientId": cfg.zoho.clientId,
      "zoho.portalId": cfg.zoho.portalId,
      "zoho.portalName": cfg.zoho.portalName,
    },
    new Set(storedNow.values.keys()),
    user.email,
  );
  await audit("settings.zoho", { detail: `guardó: ${saved.join(", ") || "—"}; quitó: ${removed.join(", ") || "—"}` });
  revalidatePath("/settings");
  return saved.length || removed.length ? { ok: `Guardado.${note}` } : { ok: `No había cambios que guardar.${note}` };
}

/** Borra lo guardado en la app para un grupo; vuelve a usarse lo que haya en variables de entorno. */
export async function removeCredentialsAction(fd: FormData): Promise<void> {
  const user = await requireAdmin();
  const group = str(fd, "group");
  if (group !== "github" && group !== "zoho") return;
  await removeSettings(GROUPS[group]);
  invalidateConfig();
  await audit(`settings.${group}.remove`, { userId: user.id, userEmail: user.email, detail: "quitó lo guardado en la app" });
  revalidatePath("/settings");
}
