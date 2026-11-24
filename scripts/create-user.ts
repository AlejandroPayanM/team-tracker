// Crea (o actualiza la contraseña de) un usuario de la app.
// Uso: npm run user:create -- correo@empresa.com "Nombre Apellido" ADMIN
// La contraseña se pide por consola (no queda en el historial del shell).
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(buf);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const [emailArg, nameArg, roleArg] = process.argv.slice(2);
  if (!emailArg || !nameArg) {
    console.error('Uso: npm run user:create -- correo@empresa.com "Nombre" [ADMIN|VIEWER]');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();
  const role = (roleArg ?? "VIEWER").toUpperCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Correo inválido");
  if (role !== "ADMIN" && role !== "VIEWER") throw new Error("Rol debe ser ADMIN o VIEWER");

  const pw = await askHidden("Contraseña (mín. 12 caracteres): ");
  const pw2 = await askHidden("Repite la contraseña: ");
  if (pw !== pw2) throw new Error("Las contraseñas no coinciden");
  if (pw.length < 12) throw new Error("La contraseña debe tener al menos 12 caracteres");

  const passwordHash = await bcrypt.hash(pw, 12);
  await db.user.upsert({
    where: { email },
    create: { email, name: nameArg, role, passwordHash },
    update: { name: nameArg, role, passwordHash, failedLogins: 0, lockedUntil: null },
  });
  await db.session.deleteMany({ where: { user: { email } } }); // invalida sesiones previas
  console.log(`Usuario ${email} (${role}) listo.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
