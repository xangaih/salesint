// Seeds the single profile row so the page works on first load. Does not overwrite an existing profile
// unless run with --force.
import { connect } from "../lib/db";
import { loadEnv } from "./env";

async function main() {
  loadEnv();
  const sql = connect();
  const force = process.argv.includes("--force");
  const [existing] = await sql`select name from profile where id = 1`;
  if (existing && !force) {
    console.log(`Profile "${existing.name}" already exists; left as is (use --force to reseed).`);
  } else {
    const p = { name: "Sample Hose & Fittings Supply", fscs: ["4720", "4730", "5330"], cages: [] as string[] };
    await sql`
      insert into profile (id, name, fscs, cages, nsns, small_business, set_asides)
      values (1, ${p.name}, ${p.fscs}, ${p.cages}, '{}', true, '{}')
      on conflict (id) do update set name = excluded.name, fscs = excluded.fscs, cages = excluded.cages,
        nsns = excluded.nsns, small_business = excluded.small_business, set_asides = excluded.set_asides`;
    console.log(`Seeded profile "${p.name}": classes ${p.fscs.join(", ")}, small business yes.`);
  }
  await sql.end();
}
main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
