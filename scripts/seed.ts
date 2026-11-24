// Seeds the single profile row so the page works on first load. Does not overwrite an existing profile
// unless run with --force.
import { connect } from "../lib/db";
import { suggestCages } from "../lib/queries";
import { loadEnv } from "./env";

async function main() {
  loadEnv();
  const sql = connect();
  const force = process.argv.includes("--force");
  const [existing] = await sql`select name from profile where id = 1`;
  if (existing && !force) {
    console.log(`Profile "${existing.name}" already exists; left as is (use --force to reseed).`);
  } else {
    const fscs = ["4720", "4730", "5330"]; // hose and tubing, fittings, seals and gaskets
    // Manufacturers are chosen from the loaded data by the focus rule, never hard-coded.
    const picked = await suggestCages(fscs, 5, sql);
    console.table(picked);
    const p = { name: "Sample Hose & Fittings Supply", fscs, cages: picked.map((c) => c.cage) };
    await sql`
      insert into profile (id, name, fscs, cages, nsns, small_business, set_asides)
      values (1, ${p.name}, ${p.fscs}, ${p.cages}, '{}', true, '{}')
      on conflict (id) do update set name = excluded.name, fscs = excluded.fscs, cages = excluded.cages,
        nsns = excluded.nsns, small_business = excluded.small_business, set_asides = excluded.set_asides`;
    console.log(`Seeded profile "${p.name}": classes ${p.fscs.join(", ")}; manufacturers ${p.cages.join(", ") || "(none)"}; small business yes.`);
  }
  await sql.end();
}
main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
