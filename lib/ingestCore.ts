// Ingest of one posting day from in-memory file contents. Used by the command-line
// script (files in ./data) and by the "Pull latest data" button (files fetched from DIBBS).
import type postgres from "postgres";
import { assertIsData, normalizeNsn, parseCsvLine, parseIndexLine, type RfqLine } from "./parse";

type Sql = ReturnType<typeof postgres>;

const BATCH = 500;
const MAX_SKIP_RATIO = 0.05;

export type DayInput = {
  ymd: string;            // post date as YYMMDD, from the file name
  indexText: string;      // inYYMMDD.txt, decoded as Latin-1
  batchText?: string;     // bqYYMMDD.txt
  sourcesText?: string;   // asYYMMDD.txt
};

export type DaySummary = {
  file_name: string;
  post_date: string;
  lines_read: number;
  rows_loaded: number;
  skipped: number;
  merged_duplicates: number;
  new_lines: number;          // lines not in the database before this run
  deadlines_extended: number; // existing lines whose deadline changed in this run
  skips: { line: number; reason: string }[];
  first_rows: RfqLine[];
  batch: { rows: number; exact: number; fallback: number; unreadable: number } | null;
  sources: { rows: number; distinct: number; added: number; unreadable: number } | null;
};

export const postDateOf = (ymd: string) => `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;

/** Loads one day. Safe to repeat: the same file changes nothing; newer files add lines and update deadlines. */
export async function ingestDay(sql: Sql, input: DayInput): Promise<DaySummary> {
  const fileName = `in${input.ymd}.txt`;
  const postDate = postDateOf(input.ymd);
  assertIsData(input.indexText, fileName);

  const skips: { line: number; reason: string }[] = [];
  const byKey = new Map<string, RfqLine>();
  let linesRead = 0, merged = 0;
  input.indexText.split(/\r?\n/).forEach((line, i) => {
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
    throw new Error(
      `${fileName}: ${skips.length} of ${linesRead} lines failed validation (over 5%). ` +
        `The format has probably changed. Nothing loaded from this file. First problem: line ${skips[0].line}, ${skips[0].reason}.`
    );
  }

  const parsed = [...byKey.values()];
  const rows = parsed.map((r) => ({ ...r, first_posted: postDate, last_posted: postDate }));

  const counts = await sql.begin(async (tx) => {
    const [{ n: before }] = await tx<{ n: number }[]>`select count(*)::int as n from rfq_lines`;
    const [{ n: extBefore }] = await tx<{ n: number }[]>`
      select count(*)::int as n from rfq_lines where prev_return_by is not null and last_posted = ${postDate}`;
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
    const [{ n: after }] = await tx<{ n: number }[]>`select count(*)::int as n from rfq_lines`;
    const [{ n: extAfter }] = await tx<{ n: number }[]>`
      select count(*)::int as n from rfq_lines where prev_return_by is not null and last_posted = ${postDate}`;
    // Record the run once per file; re-running the same file updates that record.
    await tx`delete from ingest_runs where file_name = ${fileName}`;
    await tx`
      insert into ingest_runs (file_name, post_date, lines_read, rows_loaded, skipped, skip_notes)
      values (${fileName}, ${postDate}, ${linesRead}, ${rows.length}, ${skips.length},
              ${tx.json({ merged_duplicates: merged, skips: skips.slice(0, 200) })})`;
    return { new_lines: after - before, deadlines_extended: extAfter - extBefore };
  });

  return {
    file_name: fileName, post_date: postDate, lines_read: linesRead, rows_loaded: rows.length,
    skipped: skips.length, merged_duplicates: merged, ...counts, skips, first_rows: parsed.slice(0, 3),
    batch: input.batchText != null ? await ingestBatch(sql, input.batchText, `bq${input.ymd}.txt`) : null,
    sources: input.sourcesText != null ? await ingestSources(sql, input.sourcesText, `as${input.ymd}.txt`) : null,
  };
}

async function ingestBatch(sql: Sql, text: string, name: string) {
  assertIsData(text, name);
  const rows: { sol: string; pr: string; nsn: string; bt: string }[] = [];
  let unreadable = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    if (f.length < 47 || !/^[A-Z0-9]{13}$/.test(f[0].trim())) { unreadable++; continue; }
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
  return { rows: rows.length, ...counts, unreadable };
}

async function ingestSources(sql: Sql, text: string, name: string) {
  assertIsData(text, name);
  const seen = new Map<string, { nsn: string; cage: string; part_number: string }>();
  let read = 0, unreadable = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    read++;
    const f = parseCsvLine(line);
    const nsn = normalizeNsn(f[0] ?? ""), cage = (f[1] ?? "").trim().toUpperCase(), part_number = (f[2] ?? "").trim();
    if (f.length < 3 || !nsn || !cage) { unreadable++; continue; }
    seen.set(`${nsn}|${cage}|${part_number}`, { nsn, cage, part_number });
  }
  const rows = [...seen.values()];
  let added = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const r = await sql`insert into approved_sources ${sql(rows.slice(i, i + 2000))} on conflict do nothing`;
    added += r.count;
  }
  return { rows: read, distinct: rows.length, added, unreadable };
}
