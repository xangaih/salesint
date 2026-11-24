import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../lib/db";
import { loadEnv } from "./env";

loadEnv();
async function main() {
  const sql = connect();
  await sql.unsafe(readFileSync(join(__dirname, "schema.sql"), "utf8"));
  console.log("Schema applied.");
  await sql.end();
}
main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
