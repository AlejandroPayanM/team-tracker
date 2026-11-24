// Uso: npm run sync            (incremental)
//      npm run sync -- --full  (reconsulta todo el periodo SYNC_LOOKBACK_DAYS)
import { syncAll } from "../src/lib/sync";
import { db } from "../src/lib/db";

async function main() {
  const full = process.argv.includes("--full");
  const results = await syncAll({ full, trigger: "cli" });
  for (const r of results) console.log(`${r.source}: ${r.status} (${r.items} elementos)${r.message ? " — " + r.message : ""}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
