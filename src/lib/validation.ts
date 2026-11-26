import { z } from "zod";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const githubLoginSchema = z
  .string()
  .trim()
  .regex(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i, "Usuario de GitHub inválido")
  .transform((s) => s.toLowerCase());

export const memberSchema = z.object({
  name: z.string().trim().min(2, "Nombre muy corto").max(100),
  email: z.string().trim().toLowerCase().email("Correo inválido").max(200),
  githubLogin: z.preprocess(emptyToUndef, githubLoginSchema.optional()),
  zohoEmail: z.preprocess(emptyToUndef, z.string().trim().toLowerCase().email("Correo de Zoho inválido").max(200).optional()),
  position: z.preprocess(emptyToUndef, z.string().trim().max(100).optional()),
});

export const noteSchema = z.object({
  memberId: z.string().min(1).max(40),
  kind: z.enum(["NOTE", "ACTION"]),
  body: z.string().trim().min(1, "Escribe algo").max(2000),
  dueDate: z.preprocess(
    emptyToUndef,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .transform((s) => new Date(`${s}T12:00:00Z`))
      .optional(),
  ),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

// Credenciales de integraciones: vacío = "no cambiar" (secretos) o "quitar lo guardado" (no secretos).
const optionalMatch = (re: RegExp, msg: string, max: number) =>
  z.string().trim().max(max, msg).refine((v) => v === "" || re.test(v), msg);

export const githubCredsSchema = z.object({
  token: optionalMatch(/^[\w.\-]{20,255}$/, "El token de GitHub tiene un formato inválido", 255),
  org: optionalMatch(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, "Nombre de organización de GitHub inválido", 39),
});

export const zohoCredsSchema = z.object({
  dc: z.enum(["com", "eu", "in", "com.au", "jp"], { message: "Data center no soportado" }),
  clientId: optionalMatch(/^[\w.\-]{5,100}$/, "Client ID inválido", 100),
  clientSecret: optionalMatch(/^[\w.\-]{10,200}$/, "Client Secret inválido", 200),
  refreshToken: optionalMatch(/^[\w.\-]{10,300}$/, "Refresh token inválido", 300),
  portalId: optionalMatch(/^\d{3,20}$/, "El ID del portal debe ser numérico", 20),
  portalName: optionalMatch(/^[\w.\-]{1,100}$/, "Nombre de portal inválido", 100),
});

/** Convierte un ZodError en un mensaje corto legible. */
export function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Datos inválidos";
}
