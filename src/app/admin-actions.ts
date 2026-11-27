"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, requireAdmin, requireManager } from "@/lib/auth";
import { assertMemberAccess, assertTeamAssignable } from "@/lib/access";
import { firstError } from "@/lib/validation";

// Administración de equipos y usuarios. Solo ADMIN. Nunca se guardan contraseñas en la auditoría.

export type AdminState = { error?: string; ok?: string; tempPassword?: string; email?: string };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const strs = (fd: FormData, k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 40);

const teamName = z.string().trim().min(2, "El nombre del equipo es muy corto").max(60, "El nombre del equipo es muy largo");
const roleSchema = z.enum(["ADMIN", "MANAGER", "VIEWER"]);

/** Contraseña temporal aleatoria (144 bits). Se muestra una sola vez y obliga a cambiarla al entrar. */
const tempPassword = () => randomBytes(18).toString("base64url");

const refresh = () => revalidatePath("/", "layout");

// ───────── Equipos ─────────

export async function createTeamAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  await requireAdmin();
  const name = teamName.safeParse(str(fd, "name"));
  if (!name.success) return { error: firstError(name.error) };
  try {
    const team = await db.team.create({ data: { name: name.data } });
    let moved = 0;
    if (fd.get("adopt") === "on") {
      moved = (await db.member.updateMany({ where: { teamId: null }, data: { teamId: team.id } })).count;
    }
    await audit("team.create", { target: team.id, detail: `${team.name}${moved ? ` · ${moved} personas sin equipo movidas` : ""}` });
    refresh();
    return { ok: moved ? `Equipo creado con ${moved} persona(s).` : "Equipo creado." };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Ya existe un equipo con ese nombre." };
    throw e;
  }
}

export async function renameTeamAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  await requireAdmin();
  const name = teamName.safeParse(str(fd, "name"));
  if (!name.success) return { error: firstError(name.error) };
  try {
    const team = await db.team.update({ where: { id: str(fd, "id") }, data: { name: name.data } });
    await audit("team.rename", { target: team.id, detail: team.name });
    refresh();
    return { ok: "Nombre actualizado." };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return { error: "Ya existe un equipo con ese nombre." };
      if (e.code === "P2025") return { error: "El equipo ya no existe." };
    }
    throw e;
  }
}

/**
 * Mueve a una persona a otro equipo (o la deja sin equipo con `teamId = null`). Se usa desde el tablero de equipos.
 * ADMIN: cualquier persona y equipo. Líder: solo personas de sus equipos y solo hacia sus equipos.
 */
export async function movePersonAction(memberId: string, teamId: string | null): Promise<{ error?: string }> {
  const user = await requireManager();
  try {
    const m = await assertMemberAccess(user, memberId);
    const target = await assertTeamAssignable(user, teamId);
    if (m.teamId !== target) {
      await db.member.update({ where: { id: memberId }, data: { teamId: target } });
      await audit("member.move", { target: memberId, detail: `${m.name} → ${target ?? "sin equipo"}` });
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo mover." };
  }
  refresh();
  return {};
}

/** Designa (o quita con `userId = null`) al líder de un equipo. Debe ser ADMIN o líder con acceso a ese equipo. */
export async function setTeamLeaderAction(teamId: string, userId: string | null): Promise<{ error?: string }> {
  await requireAdmin();
  const team = await db.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } });
  if (!team) return { error: "El equipo ya no existe." };
  if (userId !== null) {
    const u = await db.user.findUnique({ where: { id: userId }, select: { role: true, teams: { where: { id: teamId }, select: { id: true } } } });
    if (!u) return { error: "El usuario ya no existe." };
    if (u.role === "VIEWER") return { error: "Un usuario de solo lectura no puede ser líder." };
    if (u.role !== "ADMIN" && u.teams.length === 0) return { error: "Primero dale acceso a este equipo en Usuarios." };
  }
  await db.team.update({ where: { id: teamId }, data: { leaderId: userId } });
  await audit("team.leader", { target: teamId, detail: `${team.name} · ${userId ?? "sin líder"}` });
  refresh();
  return {};
}

/** Las personas del equipo quedan "sin equipo" (no se borran) y los usuarios pierden ese acceso. */
export async function deleteTeamAction(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = str(fd, "id");
  const team = await db.team.findUnique({ where: { id }, include: { _count: { select: { members: true } } } });
  if (!team) return;
  await db.team.delete({ where: { id } });
  await audit("team.delete", { target: id, detail: `${team.name} · ${team._count.members} personas quedaron sin equipo` });
  refresh();
}

// ───────── Usuarios ─────────

const userSchema = z.object({
  email: z.string().trim().toLowerCase().email("Correo inválido").max(200),
  name: z.string().trim().min(2, "Nombre muy corto").max(100),
  role: roleSchema,
});

async function validTeamIds(fd: FormData): Promise<string[]> {
  const ids = strs(fd, "teamIds");
  if (!ids.length) return [];
  const found = await db.team.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return found.map((t) => t.id);
}

export async function createUserAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  await requireAdmin();
  const parsed = userSchema.safeParse({ email: str(fd, "email"), name: str(fd, "name"), role: str(fd, "role") });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const d = parsed.data;
  const teamIds = d.role === "ADMIN" ? [] : await validTeamIds(fd);
  if (d.role !== "ADMIN" && teamIds.length === 0) return { error: "Elige al menos un equipo para este usuario." };

  const password = tempPassword();
  try {
    const u = await db.user.create({
      data: {
        email: d.email,
        name: d.name,
        role: d.role,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        teams: { connect: teamIds.map((id) => ({ id })) },
      },
    });
    await audit("user.create", { target: u.id, detail: `${u.email} · ${u.role}` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Ya existe un usuario con ese correo." };
    throw e;
  }
  refresh();
  return { ok: "Usuario creado. Entrégale esta contraseña temporal: no se vuelve a mostrar y tendrá que cambiarla al entrar.", tempPassword: password, email: d.email };
}

/** Cuántos ADMIN quedarían si este usuario deja de serlo. */
async function otherAdmins(userId: string) {
  return db.user.count({ where: { role: "ADMIN", id: { not: userId } } });
}

export async function updateUserAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const me = await requireAdmin();
  const id = str(fd, "id");
  const role = roleSchema.safeParse(str(fd, "role"));
  if (!role.success) return { error: "Rol no válido." };
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return { error: "El usuario ya no existe." };
  if (target.role === "ADMIN" && role.data !== "ADMIN" && (await otherAdmins(id)) === 0) {
    return { error: "Debe quedar al menos un administrador." };
  }
  if (target.id === me.id && role.data !== "ADMIN") return { error: "No puedes quitarte a ti mismo el rol de administrador." };

  const teamIds = role.data === "ADMIN" ? [] : await validTeamIds(fd);
  if (role.data !== "ADMIN" && teamIds.length === 0) return { error: "Elige al menos un equipo para este usuario." };
  await db.user.update({ where: { id }, data: { role: role.data, teams: { set: teamIds.map((t) => ({ id: t })) } } });
  // Si ya no puede dirigir un equipo (perdió el acceso o pasó a solo lectura), se le quita el liderazgo.
  if (role.data !== "ADMIN") {
    await db.team.updateMany({ where: { leaderId: id, ...(role.data === "VIEWER" ? {} : { id: { notIn: teamIds } }) }, data: { leaderId: null } });
  }
  await audit("user.update", { target: id, detail: `${target.email} · ${role.data} · ${teamIds.length} equipo(s)` });
  refresh();
  return { ok: "Cambios guardados." };
}

export async function resetPasswordAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const me = await requireAdmin();
  const id = str(fd, "id");
  if (id === me.id) return { error: "Para cambiar tu propia contraseña usa «Mi cuenta»." };
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return { error: "El usuario ya no existe." };
  const password = tempPassword();
  await db.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
  });
  await db.session.deleteMany({ where: { userId: id } });
  await audit("user.reset_password", { target: id, detail: target.email });
  return { ok: "Contraseña restablecida. Entrégasela: no se vuelve a mostrar y tendrá que cambiarla al entrar.", tempPassword: password, email: target.email };
}

export async function deleteUserAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const me = await requireAdmin();
  const id = str(fd, "id");
  if (id === me.id) return { error: "No puedes eliminar tu propia cuenta." };
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return { error: "El usuario ya no existe." };
  if (target.role === "ADMIN" && (await otherAdmins(id)) === 0) return { error: "Debe quedar al menos un administrador." };
  await db.user.delete({ where: { id } });
  await audit("user.delete", { target: id, detail: target.email });
  refresh();
  return { ok: "Usuario eliminado." };
}
