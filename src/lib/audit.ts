import { db } from "./db";
import { clientIp, getCurrentUser } from "./auth";

type AuditOpts = {
  target?: string;
  detail?: string;
  userId?: string | null;
  userEmail?: string | null;
};

/** Registro de auditoría. Nunca debe romper el flujo principal. */
export async function audit(action: string, opts: AuditOpts = {}): Promise<void> {
  try {
    let { userId, userEmail } = opts;
    if (userId === undefined) {
      const u = await getCurrentUser();
      userId = u?.id ?? null;
      userEmail = u?.email ?? null;
    }
    await db.auditLog.create({
      data: {
        action,
        target: opts.target?.slice(0, 200),
        detail: opts.detail?.slice(0, 500),
        userId: userId ?? null,
        userEmail: userEmail ?? null,
        ip: await clientIp().catch(() => null),
      },
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}
