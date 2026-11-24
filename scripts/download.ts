// Pulls DIBBS daily files (inYYMMDD.txt and bqYYMMDD.zip) into ./data and unzips the batch zip.
//
//   npx tsx scripts/download.ts --accept-consent            last 3 posting days
//   npx tsx scripts/download.ts --accept-consent --days 5
//   npx tsx scripts/download.ts --accept-consent 261123     specific post dates (YYMMDD)
//
// DIBBS shows a "DoD Warning and Consent" notice before serving files. This script accepts
// it ONLY when you pass --accept-consent: that is your decision, not the script's.
// Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1.
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipBatch } from "./unzip";

const BASE = "https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/";
const DIR = "data";
const args = process.argv.slice(2);
const acceptConsent = args.includes("--accept-consent");
const force = args.includes("--force");
const daysIdx = args.indexOf("--days");
const wantDays = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) || 3 : 3;
const explicit = args.filter((a) => /^\d{6}$/.test(a));

const cookies = new Map<string, string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a tiny cookie jar, following redirects by hand so cookies set on the way are kept. */
async function request(url: string, init: RequestInit = {}): Promise<{ url: string; res: Response; body: Buffer }> {
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
      headers: {
        ...(init.headers as Record<string, string>),
        "user-agent": "dibbs-rfq-finder/1.0 (daily file download)",
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).toString();
      init = {}; // redirects become plain GETs
      continue;
    }
    return { url, res, body: Buffer.from(await res.arrayBuffer()) };
  }
  throw new Error(`Too many redirects for ${url}`);
}

const isConsent = (b: Buffer) => b.subarray(0, 4000).toString("latin1").includes("Warning and Consent");
const isNotFound = (b: Buffer) => b.subarray(0, 20000).toString("latin1").includes("File was not found");
const looksHtml = (b: Buffer) => b.subarray(0, 200).toString("latin1").trimStart().startsWith("<");

/** Submit the consent form (the "OK" button) found in the notice page. */
async function submitConsent(pageUrl: string, html: string) {
  const action = /<form[^>]*\baction="([^"]*)"/i.exec(html)?.[1];
  if (!action) throw new Error("Consent page layout changed: no form found.");
  const form = new URLSearchParams();
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = /\bname="([^"]*)"/i.exec(m[0])?.[1];
    const value = /\bvalue="([^"]*)"/i.exec(m[0])?.[1] ?? "";
    if (name) form.set(name, value.replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
  }
  form.set("butAgree", "OK");
  return request(new URL(action.replace(/&amp;/g, "&"), pageUrl).toString(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", referer: pageUrl },
    body: form.toString(),
  });
}

/** Returns the file bytes, or null when DIBBS says the file does not exist. */
async function getFile(name: string): Promise<Buffer | null> {
  let r = await request(BASE + name);
  if (isConsent(r.body)) {
    if (!acceptConsent) {
      throw new Error(
        "DIBBS is showing its DoD Warning and Consent notice. Read it at https://www.dibbs.bsm.dla.mil/ and, " +
          "if you agree, re-run with --accept-consent."
      );
    }
    console.log(`  ${name}: consent notice shown; accepting it as instructed (--accept-consent)`);
    // DIBBS answers the consent form with the requested file itself.
    r = await submitConsent(r.url, r.body.toString("latin1"));
    if (isConsent(r.body)) throw new Error("Consent was submitted but DIBBS still shows the notice.");
  }
  if (isNotFound(r.body)) return null;
  if (!r.res.ok) throw new Error(`${name}: HTTP ${r.res.status}`);
  return r.body;
}

/** Content checks: real data, not a web page. Throws with the reason. */
function validate(name: string, b: Buffer) {
  if (name.endsWith(".zip")) {
    if (b.subarray(0, 2).toString("latin1") !== "PK") throw new Error(`${name}: not a zip file`);
    return;
  }
  if (looksHtml(b)) throw new Error(`${name}: got a web page, not data`);
  const first = b.toString("latin1").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  if (first.length < 137 || !/^[A-Z0-9]{13}$/.test(first.slice(0, 13))) {
    throw new Error(`${name}: first line does not look like an RFQ index line`);
  }
}

function save(name: string, b: Buffer) {
  const tmp = join(DIR, name + ".part");
  writeFileSync(tmp, b);
  renameSync(tmp, join(DIR, name)); // only validated content ever gets the real name
}

/** Candidate post dates, newest first: weekdays going back from today (New York). */
function* recentWeekdays(): Generator<string> {
  const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const d = new Date(ny + "T12:00:00Z");
  for (let i = 0; i < 14; i++, d.setUTCDate(d.getUTCDate() - 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) yield d.toISOString().slice(2, 10).replace(/-/g, "");
  }
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  let got = 0;
  for (const ymd of explicit.length ? explicit : recentWeekdays()) {
    if (!explicit.length && got >= wantDays) break;
    const inName = `in${ymd}.txt`, bqName = `bq${ymd}.zip`;
    if (existsSync(join(DIR, inName)) && !force) {
      console.log(`${inName}: already in ${DIR}/ (use --force to re-download)`);
    } else {
      const b = await getFile(inName);
      if (!b) { console.log(`${inName}: not posted (holiday, or not yet published)`); continue; }
      validate(inName, b);
      save(inName, b);
      const lines = b.toString("latin1").split(/\r?\n/).filter((l) => l.trim() !== "").length;
      console.log(`${inName}: ${b.length.toLocaleString()} bytes, ${lines.toLocaleString()} lines`);
      await sleep(1000);
    }
    got++;
    if (existsSync(join(DIR, bqName)) && !force) {
      console.log(`${bqName}: already in ${DIR}/`);
    } else {
      const z = await getFile(bqName);
      if (!z) { console.log(`${bqName}: not found; buy type and approved sources will be missing for this day`); continue; }
      validate(bqName, z);
      save(bqName, z);
      console.log(`${bqName}: ${z.length.toLocaleString()} bytes`);
      await sleep(1000);
    }
    const out = unzipBatch(join(DIR, bqName), DIR);
    if (out.length) console.log(`  unzipped ${out.join(", ")}`);
  }
  console.log(got ? `Done: ${got} posting day(s) in ${DIR}/. Next: npm run ingest` : "No files found.");
}

main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
