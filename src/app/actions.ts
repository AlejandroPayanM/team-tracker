"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import {
  clientIp,
  createSession,
  destroySession,
  getCurrentUser,
  requireAdmin,
  verifyLogin,
} from "@/lib/auth";
import { firstError, loginSchema, memberSchema, noteSchema } from "@/lib/validation";
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
  if (!githubLogin && env.githubConfigured) {
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
  // Trae su historial en segundo plano, sin bloquear la respuesta.
  after(async () => {
    await syncAll({ full: true, trigger: "member-added" }).catch((e) => console.error("backfill failed", e));
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
  try {
    await db.member.update({
      where: { id },
      data: {
        name: d.name,
        email: d.email,
        githubLogin: d.githubLogin ?? null,
        zohoEmail: d.zohoEmail ?? null,
        position: d.position ?? null,
        // Si cambia el correo o el correo de Zoho, se vuelve a ligar en la próxima sincronización.
        ...(before.email !== d.email || before.zohoEmail !== (d.zohoEmail ?? null) ? { zohoUserId: null } : {}),
      },
    });
  } catch (e) {
    const msg = uniqueMessage(e);
    if (msg) return { error: msg };
    throw e;
  }
  const githubChanged = before.githubLogin !== (d.githubLogin ?? null);
  await audit("member.update", { target: id, detail: d.name });
  if (githubChanged && d.githubLogin) {
    after(async () => {
      await syncAll({ full: true, trigger: "member-added" }).catch((e) => console.error("backfill failed", e));
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
  const m = await db.member.update({ where: { id }, data: { archivedAt: null } });
  await audit("member.restore", { target: id, detail: m.email });
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
  const results = await syncAll({ full, trigger: "manual" });
  await audit("sync.manual", { detail: `${full ? "full " : ""}${JSON.stringify(results)}`.slice(0, 400) });
  revalidatePath("/", "layout");
  const text = results
    .map((r) => `${r.source}: ${r.status === "OK" ? `${r.items} elementos` : (r.message ?? r.status)}`)
    .join(" · ");
  return results.some((r) => r.status === "ERROR") ? { error: text } : { ok: text };
}

export async function testConnectionsAction(_prev: FormState): Promise<FormState> {
  await requireAdmin();
  const parts: string[] = [];
  let failed = false;
  if (env.githubConfigured) {
    const r = await checkGithub();
    parts.push(r.ok ? `GitHub OK (token de ${r.login})` : `GitHub: ${r.error}`);
    failed ||= !r.ok;
  } else parts.push("GitHub: sin configurar");
  if (env.zohoConfigured) {
    const r = await checkZoho();
    parts.push(r.ok ? `Zoho OK (${r.users} usuarios en el portal)` : `Zoho: ${r.error}`);
    failed ||= !r.ok;
  } else parts.push("Zoho: sin configurar");
  return failed ? { error: parts.join(" · ") } : { ok: parts.join(" · ") };
}
