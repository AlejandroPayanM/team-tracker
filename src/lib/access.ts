import { cache } from "react";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { canManage, requireUser, type CurrentUser, type Role } from "./auth";

// Alcance de datos por equipos.
//  · ADMIN ve todos los equipos (y las personas sin equipo) y elige qué ver: un equipo, "Sin equipo" o la vista general.
//  · MANAGER / VIEWER ven únicamente los equipos que tienen asignados.
// La elección se guarda en una cookie, pero NUNCA se confía en ella: se valida contra los equipos permitidos en cada petición.

export const TEAM_COOKIE = "tt_team";

export type TeamInfo = { id: string; name: string };
export type ScopeOption = { value: string; label: string };

export type Resolution = {
  /** "all" (vista general), "none" (sin equipo; solo ADMIN) o el id de un equipo. */
  selected: string;
  label: string;
  /** Filtro de Prisma para las personas dentro del alcance elegido. */
  where: Prisma.MemberWhereInput;
  options: ScopeOption[];
};

/**
 * Decide qué alcance corresponde según el rol, los equipos a los que se tiene acceso y el valor de la cookie.
 * Función pura: cualquier valor inválido o no permitido de la cookie cae al valor por defecto.
 */
export function resolveSelection(input: {
  role: Role;
  accessible: TeamInfo[];
  cookie: string | undefined;
  /** Solo ADMIN: ¿existen personas sin equipo? (para ofrecer "Sin equipo"). */
  hasUnassigned?: boolean;
}): Resolution {
  const { role, accessible, cookie } = input;
  const byId = new Map(accessible.map((t) => [t.id, t]));

  if (role === "ADMIN") {
    const options: ScopeOption[] = [
      { value: "all", label: "Todos los equipos" },
      ...accessible.map((t) => ({ value: t.id, label: t.name })),
      ...(input.hasUnassigned ? [{ value: "none", label: "Sin equipo" }] : []),
    ];
    const selected = cookie && options.some((o) => o.value === cookie) ? cookie : "all";
    const label = options.find((o) => o.value === selected)!.label;
    const where: Prisma.MemberWhereInput = selected === "all" ? {} : selected === "none" ? { teamId: null } : { teamId: selected };
    return { selected, label, where, options };
  }

  // Líder de equipo / solo lectura: solo lo asignado. Sin equipos asignados no ve nada.
  const ids = accessible.map((t) => t.id);
  const options: ScopeOption[] =
    accessible.length > 1
      ? [{ value: "all", label: "Todos mis equipos" }, ...accessible.map((t) => ({ value: t.id, label: t.name }))]
      : accessible.map((t) => ({ value: t.id, label: t.name }));
  const fallback = accessible.length === 1 ? accessible[0]!.id : "all";
  const selected = cookie && (cookie === "all" ? accessible.length > 1 : byId.has(cookie)) ? cookie : fallback;
  const label = selected === "all" ? (accessible.length ? "Todos mis equipos" : "Sin equipos asignados") : byId.get(selected)!.name;
  const where: Prisma.MemberWhereInput = selected === "all" ? { teamId: { in: ids } } : { teamId: selected };
  return { selected, label, where, options };
}

export type Scope = Resolution & {
  user: CurrentUser;
  isAdmin: boolean;
  canManage: boolean;
  /** Equipos a los que el usuario tiene acceso (todos, si es ADMIN). */
  teams: TeamInfo[];
  /** Ids de las personas (activas y archivadas) dentro del alcance elegido. */
  memberIds: () => Promise<string[]>;
  /** ¿Puede el usuario ver a una persona de este equipo? (independiente de lo que tenga elegido en el selector). */
  canAccessTeam: (teamId: string | null) => boolean;
};

/** Calcula el alcance de un usuario ya autenticado (también sirve en route handlers, que no deben redirigir). */
export async function scopeFor(user: CurrentUser): Promise<Scope> {
  const isAdmin = user.role === "ADMIN";
  const teams: TeamInfo[] = isAdmin
    ? await db.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
    : ((await db.user.findUnique({ where: { id: user.id }, select: { teams: { select: { id: true, name: true }, orderBy: { name: "asc" } } } }))?.teams ?? []);
  const hasUnassigned = isAdmin ? (await db.member.count({ where: { teamId: null } })) > 0 : false;
  const cookie = (await cookies()).get(TEAM_COOKIE)?.value;
  const res = resolveSelection({ role: user.role, accessible: teams, cookie, hasUnassigned });

  let ids: Promise<string[]> | undefined;
  const allowed = new Set(teams.map((t) => t.id));
  return {
    ...res,
    user,
    isAdmin,
    canManage: canManage(user.role),
    teams,
    memberIds: () => (ids ??= db.member.findMany({ where: res.where, select: { id: true } }).then((r) => r.map((m) => m.id))),
    canAccessTeam: (teamId) => (isAdmin ? true : teamId !== null && allowed.has(teamId)),
  };
}

export const getScope = cache(async (): Promise<Scope> => scopeFor(await requireUser()));

/** Equipos que un usuario puede ver. `null` = todos (ADMIN). Para acciones del servidor, donde no hay selector. */
export async function accessibleTeamIds(user: CurrentUser): Promise<string[] | null> {
  if (user.role === "ADMIN") return null;
  const u = await db.user.findUnique({ where: { id: user.id }, select: { teams: { select: { id: true } } } });
  return u?.teams.map((t) => t.id) ?? [];
}

/** Lanza si el usuario no puede operar sobre esta persona. Devuelve la persona. */
export async function assertMemberAccess(user: CurrentUser, memberId: string) {
  const m = await db.member.findUnique({ where: { id: memberId } });
  if (!m) throw new Error("Compañero no encontrado.");
  const ids = await accessibleTeamIds(user);
  if (ids !== null && (m.teamId === null || !ids.includes(m.teamId))) throw new Error("No tienes acceso a esta persona.");
  return m;
}

/**
 * Valida el equipo al que se quiere asignar a una persona. ADMIN: cualquier equipo existente o ninguno.
 * Líder de equipo: obligatoriamente uno de los suyos.
 */
export async function assertTeamAssignable(user: CurrentUser, teamId: string | null): Promise<string | null> {
  if (teamId !== null && !(await db.team.findUnique({ where: { id: teamId }, select: { id: true } }))) {
    throw new Error("El equipo elegido no existe.");
  }
  const ids = await accessibleTeamIds(user);
  if (ids === null) return teamId;
  if (teamId === null || !ids.includes(teamId)) throw new Error("Solo puedes asignar personas a tus equipos.");
  return teamId;
}
