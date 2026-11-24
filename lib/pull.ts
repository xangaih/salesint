// "Pull latest data": fetch every posting day newer than what is loaded, straight from DIBBS,
// and ingest it. Nothing is written to disk. Repeating a pull changes nothing.
import { db } from "./db";
import { DibbsSession, recentWeekdays, unzipBatchBuffer } from "./dibbs";
import { ingestDay, type DaySummary } from "./ingestCore";

export type PullDay = Omit<DaySummary, "skips" | "first_rows">;
export type PullResult = { days: PullDay[]; not_posted: string[]; loaded_through: string | null; message: string };

const FIRST_LOAD_DAYS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pullLatest(): Promise<PullResult> {
  const sql = db();
  const [{ latest }] = await sql<{ latest: string | null }[]>`
    select to_char(max(post_date), 'YYMMDD') as latest from ingest_runs`;
  // Newest first. With data loaded: only days after it. Empty database: the last few posting days.
  const candidates = recentWeekdays().filter((ymd) => !latest || ymd > latest);

  // The user asked for the DoD consent notice to be accepted automatically on each pull.
  const dibbs = new DibbsSession(true);
  const fetched: { ymd: string; index: Buffer; zip: Buffer | null }[] = [];
  const notPosted: string[] = [];
  for (const ymd of candidates) {
    if (!latest && fetched.length >= FIRST_LOAD_DAYS) break;
    const index = await dibbs.getFile(`in${ymd}.txt`);
    if (!index) { notPosted.push(ymd); continue; }
    await sleep(300);
    fetched.push({ ymd, index, zip: await dibbs.getFile(`bq${ymd}.zip`) });
    await sleep(300);
  }

  const days: PullDay[] = [];
  for (const f of fetched.reverse()) { // oldest post date first
    const files = f.zip ? unzipBatchBuffer(f.zip) : new Map<string, Buffer>();
    const { skips: _s, first_rows: _f, ...summary } = await ingestDay(sql, {
      ymd: f.ymd,
      indexText: f.index.toString("latin1"),
      batchText: files.get(`bq${f.ymd}.txt`)?.toString("latin1"),
      sourcesText: files.get(`as${f.ymd}.txt`)?.toString("latin1"),
    });
    days.push(summary);
  }

  const [{ through }] = await sql<{ through: string | null }[]>`select max(post_date)::text as through from ingest_runs`;
  const newLines = days.reduce((n, d) => n + d.new_lines, 0);
  const extended = days.reduce((n, d) => n + d.deadlines_extended, 0);
  const skipped = days.reduce((n, d) => n + d.skipped, 0);
  const message = days.length
    ? `Pulled ${days.length} posting ${days.length === 1 ? "day" : "days"}: ${newLines.toLocaleString("en-US")} new lines` +
      (extended ? `, ${extended} deadlines extended` : "") + `, ${skipped} skipped.`
    : "Already up to date. DIBBS has not posted a newer daily file yet.";
  return { days, not_posted: notPosted, loaded_through: through, message };
}
