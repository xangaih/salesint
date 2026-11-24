// Usage: npx tsx scripts/ingest.ts [dir]   (dir defaults to ./data)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../lib/db";
import { unzipBatchBuffer } from "../lib/dibbs";
import { ingestDay } from "../lib/ingestCore";
import { loadEnv } from "./env";

const dir = process.argv[2] ?? "data";

/** Find a file in dir by lower-case name (DIBBS names are sometimes upper-case). */
function find(name: string): string | null {
  const hit = readdirSync(dir).find((f) => f.toLowerCase() === name);
  return hit ? join(dir, hit) : null;
}
const read = (name: string) => { const p = find(name); return p ? readFileSync(p, "latin1") : undefined; };

/** If only bqYYMMDD.zip is present, extract bq/as text files next to it. */
function unzipIfNeeded(ymd: string) {
  const zip = find(`bq${ymd}.zip`);
  if (!zip || (find(`bq${ymd}.txt`) && find(`as${ymd}.txt`))) return;
  for (const [name, bytes] of unzipBatchBuffer(readFileSync(zip))) {
    if (!find(name)) { writeFileSync(join(dir, name), bytes); console.log(`  unzipped ${name}`); }
  }
}

async function main() {
  loadEnv();
  const sql = connect();
  try {
    if (!existsSync(dir)) throw new Error(`Folder ${dir} does not exist.`);
    const days = readdirSync(dir)
      .map((f) => /^in(\d{6})\.txt$/i.exec(f)?.[1])
      .filter((ymd): ymd is string => !!ymd)
      .sort(); // oldest post date first
    if (days.length === 0) throw new Error(`No in*.txt files found in ${dir}.`);

    for (const ymd of days) {
      try {
        unzipIfNeeded(ymd);
        const s = await ingestDay(sql, {
          ymd, indexText: read(`in${ymd}.txt`)!, batchText: read(`bq${ymd}.txt`), sourcesText: read(`as${ymd}.txt`),
        });
        if (process.env.SHOW_SAMPLE !== "0") console.log("  first 3 parsed rows:", s.first_rows);
        console.log(
          `${s.file_name}: ${s.lines_read} lines, ${s.rows_loaded} loaded, ${s.skipped} skipped` +
            (s.merged_duplicates ? `, ${s.merged_duplicates} duplicate keys merged` : "") +
            ` (${s.new_lines} new, ${s.deadlines_extended} deadlines extended)`
        );
        for (const k of s.skips.slice(0, 10)) console.log(`  skipped line ${k.line}: ${k.reason}`);
        if (s.skips.length > 10) console.log(`  ... and ${s.skips.length - 10} more (see ingest_runs.skip_notes)`);
        console.log(s.batch
          ? `  bq${ymd}.txt: ${s.batch.rows} rows, buy_type set on ${s.batch.exact} lines (exact key) + ${s.batch.fallback} (solicitation+PR fallback)` +
            (s.batch.unreadable ? `, ${s.batch.unreadable} unreadable rows` : "")
          : `  bq${ymd}.txt not found: buy_type left as is`);
        console.log(s.sources
          ? `  as${ymd}.txt: ${s.sources.rows} rows, ${s.sources.distinct} distinct, ${s.sources.added} new` +
            (s.sources.unreadable ? `, ${s.sources.unreadable} unreadable rows` : "")
          : `  as${ymd}.txt not found: approved sources unchanged`);
      } catch (e) {
        process.exitCode = 1;
        console.error(`ERROR ${(e as Error).message}`);
      }
    }
    const [t] = await sql`
      select (select count(*)::int from rfq_lines) as lines, (select count(*)::int from approved_sources) as sources`;
    console.log(`Database now holds ${t.lines} RFQ lines and ${t.sources} approved-source rows.`);
  } catch (e) {
    process.exitCode = 1;
    console.error(`ERROR ${(e as Error).message}`);
  } finally {
    await sql.end();
  }
}
main();
