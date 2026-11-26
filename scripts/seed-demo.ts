// Datos de DEMOSTRACIÓN para probar la app en local. Solo corre contra una base local.
// Uso: npm run local seed:demo
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { addWeeks, startOfWeek } from "../src/lib/weeks";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("ABORTADO: esta base no es local. Usa `npm run local seed:demo`.");
  process.exit(1);
}

// Generador pseudoaleatorio determinista: siempre los mismos datos de demostración.
let s = 20261124;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]!;

const REPOS = ["acme/api", "acme/web", "acme/mobile"];
const PEOPLE = [
  { name: "Ana Demo", email: "ana.demo@example.com", login: "ana-demo" },
  { name: "Beto Demo", email: "beto.demo@example.com", login: "beto-demo" },
  { name: "Carla Demo", email: "carla.demo@example.com", login: "carla-demo" },
];

async function main() {
  const members = [];
  for (const p of PEOPLE) {
    members.push(
      await db.member.upsert({
        where: { email: p.email },
        create: { name: p.name, email: p.email, githubLogin: p.login, position: "Desarrollo", githubSyncedAt: new Date(), zohoSyncedAt: new Date() },
        update: {},
      }),
    );
  }

  const W0 = startOfWeek(new Date());
  let n = 0;
  for (let w = -11; w <= 0; w++) {
    for (const m of members) {
      const count = Math.floor(rnd() * 4); // 0..3 PRs por persona y semana
      for (let k = 0; k < count; k++) {
        n++;
        const created = new Date(addWeeks(W0, w).getTime() + (1 + rnd() * 3) * 86400000 + rnd() * 8 * 3600000);
        if (created > new Date()) continue;
        const roll = rnd();
        const state = roll < 0.7 ? "MERGED" : roll < 0.85 ? "OPEN" : "CLOSED";
        const ended = new Date(created.getTime() + (0.3 + rnd() * 4) * 86400000);
        const finished = state !== "OPEN" && ended < new Date() ? ended : null;
        const finalState = finished ? state : "OPEN";
        const githubId = `DEMO_${n}`;
        const repo = pick(REPOS);
        const pr = await db.pullRequest.upsert({
          where: { githubId },
          create: {
            githubId, repo, number: 100 + n, title: `Demo: cambio ${n}`, url: `https://github.com/${repo}/pull/${100 + n}`,
            state: finalState, authorLogin: m.githubLogin!, memberId: m.id, createdAtGh: created, updatedAtGh: finished ?? created,
            mergedAt: finalState === "MERGED" ? finished : null, closedAt: finished,
            additions: Math.floor(rnd() * 300), deletions: Math.floor(rnd() * 120), changedFiles: 1 + Math.floor(rnd() * 12),
          },
          update: {},
        });
        // Un review de otra persona del equipo en la mayoría de los PRs.
        if (rnd() < 0.8) {
          const reviewer = pick(members.filter((x) => x.id !== m.id));
          const at = new Date(created.getTime() + rnd() * 2 * 86400000);
          if (at < new Date()) {
            await db.prReview.upsert({
              where: { githubId: `DEMO_R_${n}` },
              create: { githubId: `DEMO_R_${n}`, pullRequestId: pr.id, reviewerLogin: reviewer.githubLogin!, memberId: reviewer.id, state: "APPROVED", submittedAt: at },
              update: {},
            });
          }
        }
      }
    }
  }

  // Algunas tareas de Zoho de demostración.
  for (let i = 0; i < 12; i++) {
    const m = pick(members);
    const done = rnd() < 0.6;
    const updated = new Date(Date.now() - rnd() * 60 * 86400000);
    await db.zohoTask.upsert({
      where: { zohoId: `DEMO_T_${i}` },
      create: {
        zohoId: `DEMO_T_${i}`, projectId: "demo", projectName: "Proyecto Demo", name: `Tarea de demostración ${i + 1}`,
        status: done ? "Cerrada" : "En progreso", completed: done, updatedAtZ: updated, completedAt: done ? updated : null,
        dueDate: done ? null : new Date(Date.now() + (rnd() * 20 - 8) * 86400000), members: { connect: { id: m.id } },
      },
      update: {},
    });
  }

  // Usuario de prueba para entrar (solo existe en la base local).
  const email = "demo@local.test";
  let password: string | null = null;
  if (!(await db.user.findUnique({ where: { email } }))) {
    password = randomBytes(9).toString("base64url");
    await db.user.create({ data: { email, name: "Demo Local", role: "ADMIN", passwordHash: await bcrypt.hash(password, 12) } });
  }

  console.log(`Datos de demostración listos (${n} PRs generados, 3 compañeros, 3 repositorios).`);
  if (password) console.log(`\nUsuario de prueba (solo local):\n  correo:     ${email}\n  contraseña: ${password}`);
  else console.log(`\nEl usuario ${email} ya existía; usa su contraseña (o recrea la base con: npm run local reset).`);
}

main().finally(() => db.$disconnect());
