import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";

/** Extract bqYYMMDD.txt and asYYMMDD.txt from a batch zip into dir. Only those two names are written. */
export function unzipBatch(zipPath: string, dir: string): string[] {
  const buf = readFileSync(zipPath);
  if (buf.subarray(0, 2).toString("latin1") !== "PK") {
    throw new Error(`${zipPath} is not a zip file (probably a DIBBS web page).`);
  }
  const have = new Set(readdirSync(dir).map((f) => f.toLowerCase()));
  const written: string[] = [];
  for (const [entry, bytes] of Object.entries(unzipSync(buf))) {
    const base = entry.split(/[\\/]/).pop()!.toLowerCase();
    if (/^(bq|as)\d{6}\.txt$/.test(base) && !have.has(base)) {
      writeFileSync(join(dir, base), bytes);
      written.push(base);
    }
  }
  return written;
}
