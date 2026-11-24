// Pulls DIBBS daily files (inYYMMDD.txt and bqYYMMDD.zip) into ./data and unzips the batch zip.
//
//   npx tsx scripts/download.ts --accept-consent            last 3 posting days
//   npx tsx scripts/download.ts --accept-consent --days 5
//   npx tsx scripts/download.ts --accept-consent 261123     specific post dates (YYMMDD)
//
// DIBBS shows a "DoD Warning and Consent" notice before serving files. This script accepts
// it ONLY when you pass --accept-consent. Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DibbsSession, recentWeekdays, unzipBatchBuffer } from "../lib/dibbs";

const DIR = "data";
const args = process.argv.slice(2);
const force = args.includes("--force");
const daysIdx = args.indexOf("--days");
const wantDays = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) || 3 : 3;
const explicit = args.filter((a) => /^\d{6}$/.test(a));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function save(name: string, b: Buffer) {
  const tmp = join(DIR, name + ".part");
  writeFileSync(tmp, b);
  renameSync(tmp, join(DIR, name)); // only validated content ever gets the real name
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const dibbs = new DibbsSession(args.includes("--accept-consent"), (m) => console.log(`  ${m}`));
  let got = 0;
  for (const ymd of explicit.length ? explicit : recentWeekdays()) {
    if (!explicit.length && got >= wantDays) break;
    const inName = `in${ymd}.txt`, bqName = `bq${ymd}.zip`;
    if (existsSync(join(DIR, inName)) && !force) {
      console.log(`${inName}: already in ${DIR}/ (use --force to re-download)`);
    } else {
      const b = await dibbs.getFile(inName); // validated as real data, or null
      if (!b) { console.log(`${inName}: not posted (holiday, or not yet published)`); continue; }
      save(inName, b);
      const lines = b.toString("latin1").split(/\r?\n/).filter((l) => l.trim() !== "").length;
      console.log(`${inName}: ${b.length.toLocaleString()} bytes, ${lines.toLocaleString()} lines`);
      await sleep(1000);
    }
    got++;
    if (existsSync(join(DIR, bqName)) && !force) {
      console.log(`${bqName}: already in ${DIR}/`);
    } else {
      const z = await dibbs.getFile(bqName);
      if (!z) { console.log(`${bqName}: not found; buy type and approved sources will be missing for this day`); continue; }
      save(bqName, z);
      console.log(`${bqName}: ${z.length.toLocaleString()} bytes`);
      await sleep(1000);
    }
    const out: string[] = [];
    for (const [name, bytes] of unzipBatchBuffer(readFileSync(join(DIR, bqName)))) {
      if (!existsSync(join(DIR, name)) || force) { writeFileSync(join(DIR, name), bytes); out.push(name); }
    }
    if (out.length) console.log(`  unzipped ${out.join(", ")}`);
  }
  console.log(got ? `Done: ${got} posting day(s) in ${DIR}/. Next: npm run ingest` : "No files found.");
}

main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
