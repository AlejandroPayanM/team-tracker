// Ejecuta cualquier script de npm contra el Postgres LOCAL de Docker, sin importar lo que diga .env
// (que normalmente apunta a Neon/producción). Las variables de entorno del proceso tienen prioridad
// sobre .env, tanto para Next.js como para Prisma.
//
//   npm run local setup        levanta Postgres (Docker) y aplica las migraciones
//   npm run local dev          app en http://localhost:3004 con la base local
//   npm run local seed:demo    datos de demostración (solo en base local)
//   npm run local user:create -- correo@x.com "Nombre" ADMIN
//   npm run local down         apaga Postgres (conserva los datos)
//   npm run local reset        apaga y BORRA los datos locales
import { spawnSync } from "node:child_process";

const LOCAL_URL = "postgresql://tracker:tracker-dev-only@127.0.0.1:5440/tracker";
const env = { ...process.env, DATABASE_URL: LOCAL_URL, DIRECT_URL: LOCAL_URL, TRUST_PROXY: "false" };

const [cmd, ...rest] = process.argv.slice(2);

// Un solo comando con shell (necesario para npm/npx en Windows); los argumentos con espacios se entrecomillan.
const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function run(command, args, opts = {}) {
  const r = spawnSync([command, ...args].map(quote).join(" "), { stdio: "inherit", env, shell: true, ...opts });
  if (r.status !== 0 && !opts.allowFail) process.exit(r.status ?? 1);
  return r.status === 0;
}

if (!cmd) {
  console.log("Uso: npm run local <setup|dev|seed:demo|user:create|down|reset|otro-script> [args]");
  process.exit(1);
}

console.log("▶ Base de datos LOCAL: 127.0.0.1:5440 (no se toca Neon)\n");

if (cmd === "setup") {
  run("docker", ["compose", "up", "-d"]);
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    ready = run("docker", ["compose", "exec", "-T", "db", "pg_isready", "-U", "tracker"], {
      stdio: "ignore",
      allowFail: true,
    });
    if (!ready) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},1000)"]);
  }
  if (!ready) {
    console.error("Postgres no respondió a tiempo. ¿Docker Desktop está abierto?");
    process.exit(1);
  }
  run("npx", ["prisma", "migrate", "deploy"]);
  console.log("\nListo. Siguientes pasos:");
  console.log("  npm run local seed:demo   (datos de demostración y un usuario de prueba)");
  console.log("  npm run local dev         (abre http://localhost:3004)");
} else if (cmd === "down") {
  run("docker", ["compose", "down"]);
} else if (cmd === "reset") {
  run("docker", ["compose", "down", "-v"]);
  console.log("Base local borrada. Vuelve a correr: npm run local setup");
} else {
  run("npm", ["run", cmd, ...(rest.length ? ["--", ...rest] : [])]);
}
