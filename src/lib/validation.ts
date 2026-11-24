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

/** Convierte un ZodError en un mensaje corto legible. */
export function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Datos inválidos";
}
