// Usage: npx tsx scripts/ingest.ts [dir]   (dir defaults to ./data)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { connect } from "../lib/db";
import { assertIsData, normalizeNsn, parseCsvLine, parseIndexLine, type RfqLine } from "../lib/parse";
import { loadEnv } from "./env";

const BATCH = 500;
const MAX_SKIP_RATIO = 0.05;

const dir = process.argv[2] ?? "data";
loadEnv();
const sql = connect();

function readLatin1(path: string, name: string): string {
  const content = readFileSync(path, "latin1");
  assertIsData(content, name);
  return content;
}

/** Find a file in dir by lower-case name (DIBBS names are sometimes upper-case). */
function find(name: string): string | null {
  const hit = readdirSync(dir).find((f) => f.toLowerCase() === name);
  return hit ? join(dir, hit) : null;
}

/** If only bqYYMMDD.zip is present, extract bq/as text files next to it. */
function unzipIfNeeded(ymd: string) {
  const zip = find(`bq${ymd}.zip`);
  if (!zip || (find(`bq${ymd}.txt`) && find(`as${ymd}.txt`))) return;
  const head = readFileSync(zip).subarray(0, 2).toString("latin1");
  if (head !== "PK") throw new Error(`bq${ymd}.zip is not a zip file (probably a DIBBS web page). Nothing loaded.`);
  for (const [entry, bytes] of Object.entries(unzipSync(readFileSync(zip)))) {
    const base = entry.split(/[\\/]/).pop()!.toLowerCase();
    if (/^(bq|as)\d{6}\.txt$/.test(base) && !find(base)) {
      writeFileSync(join(dir, base), bytes);
      console.log(`  unzipped ${base}`);
    }
  }
}

async function ingestIndex(path: string, fileName: string, ymd: string, postDate: string) {
  const lines = readLatin1(path, fileName).split(/\r?\n/);
  const skips: { line: number; reason: string }[] = [];
  const byKey = new Map<string, RfqLine>();
  let linesRead = 0, merged = 0;

  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    linesRead++;
    const r = parseIndexLine(line);
    if (!r.ok) return void skips.push({ line: i + 1, reason: r.reason });
    const key = `${r.row.solicitation}|${r.row.pr}|${r.row.nsn}`;
    if (byKey.has(key)) merged++;
    byKey.set(key, r.row); // same key twice in one file: keep the later line
  });

  if (linesRead === 0) throw new Error(`${fileName}: no lines. Nothing loaded.`);
  if (skips.length / linesRead > MAX_SKIP_RATIO) {
    console.error(skips.slice(0, 5));
    throw new Error(
      `${fileName}: ${skips.length} of ${linesRead} lines failed validation (over 5%). ` +
        `The format has probably changed. Nothing loaded from this file.`
    );
  }

  const rows = [...byKey.values()].map((r) => ({ ...r, first_posted: postDate, last_posted: postDate }));
  if (process.env.SHOW_SAMPLE !== "0") console.log("  first 3 parsed rows:", rows.slice(0, 3));

  await sql.begin(async (tx) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      await tx`
        insert into rfq_lines ${tx(rows.slice(i, i + BATCH))}
        on conflict (solicitation, pr, nsn) do update set
          prev_return_by = case
            when excluded.last_posted > rfq_lines.last_posted and excluded.return_by <> rfq_lines.return_by
            then rfq_lines.return_by else rfq_lines.prev_return_by end,
          return_by  = case when excluded.last_posted >= rfq_lines.last_posted then excluded.return_by  else rfq_lines.return_by  end,
          qty        = case when excluded.last_posted >= rfq_lines.last_posted then excluded.qty        else rfq_lines.qty        end,
          uom        = case when excluded.last_posted >= rfq_lines.last_posted then excluded.uom        else rfq_lines.uom        end,
          item       = case when excluded.last_posted >= rfq_lines.last_posted then excluded.item       else rfq_lines.item       end,
          set_aside  = case when excluded.last_posted >= rfq_lines.last_posted then excluded.set_aside  else rfq_lines.set_aside  end,
          item_type  = case when excluded.last_posted >= rfq_lines.last_posted then excluded.item_type  else rfq_lines.item_type  end,
          first_posted = least(rfq_lines.first_posted, excluded.first_posted),
          last_posted  = greatest(rfq_lines.last_posted, excluded.last_posted)`;
    }
    // Record the run once per file; re-running the same file updates that record.
    await tx`delete from ingest_runs where file_name = ${fileName}`;
    await tx`
      insert into ingest_runs (file_name, post_date, lines_read, rows_loaded, skipped, skip_notes)
      values (${fileName}, ${postDate}, ${linesRead}, ${rows.length}, ${skips.length},
              ${tx.json({ merged_duplicates: merged, skips: skips.slice(0, 200) })})`;
  });

  console.log(
    `${fileName}: ${linesRead} lines, ${rows.length} loaded, ${skips.length} skipped` +
      (merged ? `, ${merged} duplicate keys merged` : "")
  );
  for (const s of skips.slice(0, 10)) console.log(`  skipped line ${s.line}: ${s.reason}`);
  if (skips.length > 10) console.log(`  ... and ${skips.length - 10} more (see ingest_runs.skip_notes)`);
}

async function ingestBatch(ymd: string) {
  const path = find(`bq${ymd}.txt`);
  if (!path) return console.log(`  bq${ymd}.txt not found: buy_type left as is`);
  const rows: { sol: string; pr: string; nsn: string; bt: string }[] = [];
  let bad = 0;
  for (const line of readLatin1(path, `bq${ymd}.txt`).split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    if (f.length < 47 || !/^[A-Z0-9]{13}$/.test(f[0].trim())) { bad++; continue; }
    rows.push({ sol: f[0].trim(), pr: f[45].trim(), nsn: normalizeNsn(f[46]), bt: f[1].trim() });
  }
  const counts = await sql.begin(async (tx) => {
    await tx`create temp table bq_in (sol text, pr text, nsn text, bt text) on commit drop`;
    for (let i = 0; i < rows.length; i += 2000) await tx`insert into bq_in ${tx(rows.slice(i, i + 2000))}`;
    const exact = await tx`
      update rfq_lines r set buy_type = b.bt from bq_in b
      where r.solicitation = b.sol and r.pr = b.pr and r.nsn = b.nsn and r.buy_type is distinct from b.bt`;
    const fallback = await tx`
      update rfq_lines r set buy_type = b.bt from bq_in b
      where r.solicitation = b.sol and r.pr = b.pr and r.buy_type is null
        and not exists (select 1 from rfq_lines x where x.solicitation = b.sol and x.pr = b.pr and x.nsn = b.nsn)`;
    return { exact: exact.count, fallback: fallback.count };
  });
  console.log(
    `  bq${ymd}.txt: ${rows.length} rows, buy_type set on ${counts.exact} lines (exact key) + ${counts.fallback} (solicitation+PR fallback)` +
      (bad ? `, ${bad} unreadable rows` : "")
  );
}

async function ingestSources(ymd: string) {
  const path = find(`as${ymd}.txt`);
  if (!path) return console.log(`  as${ymd}.txt not found: approved sources unchanged`);
  const seen = new Map<string, { nsn: string; cage: string; part_number: string }>();
  let read = 0, bad = 0;
  for (const line of readLatin1(path, `as${ymd}.txt`).split(/\r?\n/)) {
    if (line.trim() === "") continue;
    read++;
    const f = parseCsvLine(line);
    const nsn = normalizeNsn(f[0] ?? ""), cage = (f[1] ?? "").trim().toUpperCase(), part_number = (f[2] ?? "").trim();
    if (f.length < 3 || !nsn || !cage) { bad++; continue; }
    seen.set(`${nsn}|${cage}|${part_number}`, { nsn, cage, part_number });
  }
  const rows = [...seen.values()];
  let added = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const r = await sql`insert into approved_sources ${sql(rows.slice(i, i + 2000))} on conflict do nothing`;
    added += r.count;
  }
  console.log(`  as${ymd}.txt: ${read} rows, ${rows.length} distinct, ${added} new` + (bad ? `, ${bad} unreadable rows` : ""));
}

async function main() {
try {
  if (!existsSync(dir)) throw new Error(`Folder ${dir} does not exist.`);
  const files = readdirSync(dir)
    .map((f) => ({ f, m: /^in(\d{6})\.txt$/i.exec(f) }))
    .filter((x) => x.m)
    .map((x) => ({ fileName: x.f, ymd: x.m![1] }))
    .sort((a, b) => a.ymd.localeCompare(b.ymd)); // oldest post date first
  if (files.length === 0) throw new Error(`No in*.txt files found in ${dir}.`);

  for (const { fileName, ymd } of files) {
    const postDate = `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;
    try {
      await ingestIndex(join(dir, fileName), fileName, ymd, postDate);
      unzipIfNeeded(ymd);
      await ingestBatch(ymd);
      await ingestSources(ymd);
    } catch (e) {
      process.exitCode = 1;
      console.error(`ERROR ${(e as Error).message}`);
    }
  }
  const [t] = await sql`
    select (select count(*)::int from rfq_lines) as lines,
           (select count(*)::int from approved_sources) as sources`;
  console.log(`Database now holds ${t.lines} RFQ lines and ${t.sources} approved-source rows.`);
} catch (e) {
  process.exitCode = 1;
  console.error(`ERROR ${(e as Error).message}`);
} finally {
  await sql.end();
}
}
main();
