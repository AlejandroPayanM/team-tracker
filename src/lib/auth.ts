import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "./db";

const isProd = process.env.NODE_ENV === "production";
// El prefijo __Host- obliga Secure + Path=/ + sin Domain (solo en producción/HTTPS).
export const SESSION_COOKIE = isProd ? "__Host-tt_session" : "tt_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const BCRYPT_COST = 12;

const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 40;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type Role = "ADMIN" | "VIEWER";

export async function clientIp(): Promise<string> {
  if (process.env.TRUST_PROXY === "true") {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim().slice(0, 64);
  }
  return "direct";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

let dummyHash: Promise<string> | undefined;
// Para igualar tiempos de respuesta cuando el correo no existe.
const getDummyHash = () => (dummyHash ??= bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_COST));

export type LoginResult = { ok: true; userId: string } | { ok: false; error: string };

export async function verifyLogin(emailRaw: string, password: string, ip: string): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const generic = "Correo o contraseña incorrectos.";
  const since = new Date(Date.now() - WINDOW_MS);

  const [failsEmail, failsIp] = await Promise.all([
    db.loginAttempt.count({ where: { email, success: false, createdAt: { gt: since } } }),
    ip === "direct"
      ? Promise.resolve(0) // sin IP confiable no limitamos por IP (evita bloqueo global)
      : db.loginAttempt.count({ where: { ip, success: false, createdAt: { gt: since } } }),
  ]);
  if (failsEmail >= MAX_FAILS_PER_EMAIL || failsIp >= MAX_FAILS_PER_IP) {
    return { ok: false, error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." };
  }

  const user = await db.user.findUnique({ where: { email } });
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." };
  }

  const valid = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid) {
    await db.loginAttempt.create({ data: { email, ip, success: false } });
    if (user) {
      const failedLogins = user.failedLogins + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLogins,
          lockedUntil: failedLogins % MAX_FAILS_PER_EMAIL === 0 ? new Date(Date.now() + LOCK_MS) : null,
        },
      });
    }
    return { ok: false, error: generic };
  }

  await db.loginAttempt.create({ data: { email, ip, success: true } });
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  return { ok: true, userId: user.id };
}

export async function createSession(userId: string, ip: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const h = await headers();
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      ip,
      userAgent: h.get("user-agent")?.slice(0, 200) ?? null,
    },
  });
  // Limpieza oportunista de sesiones vencidas y de intentos de login viejos.
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export type CurrentUser = { id: string; email: string; name: string; role: Role };

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 128) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const { user } = session;
  return { id: user.id, email: user.email, name: user.name, role: user.role === "ADMIN" ? "ADMIN" : "VIEWER" };
});

/** Para páginas: redirige a /login si no hay sesión. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Para páginas y acciones que solo puede usar un ADMIN. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("No tienes permisos para esta acción.");
  return user;
}
