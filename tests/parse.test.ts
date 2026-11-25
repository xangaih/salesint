import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIndexLine, parseCsvLine, parseMdy, assertIsData, setAsideLabel, formatNsn, formatSolicitation, normalizeNsn } from "../lib/parse";

/** Build a 140-char index line by padding values into the documented slices. */
export function buildLine(f: Record<string, string>): string {
  const buf = Array(140).fill(" ");
  const put = (start: number, end: number, v: string, right = false) => {
    const s = right ? v.padStart(end - start) : v.padEnd(end - start);
    for (let i = 0; i < end - start; i++) buf[start + i] = s[i];
  };
  put(0, 13, f.solicitation);
  put(13, 59, f.nsn);
  put(59, 72, f.pr, true);
  put(72, 80, f.return_by);
  put(99, 106, f.qty);
  put(106, 108, f.uom);
  put(108, 129, f.item);
  put(135, 136, f.item_type);
  put(136, 137, f.set_aside);
  return buf.join("");
}

const sample = {
  solicitation: "SPE1C127Q0127", nsn: "8455011456344", pr: "7018634838", return_by: "11/24/26",
  qty: "0024000", uom: "EA", item: "SERVICE RIBBON,AWAR", item_type: "1", set_aside: "N",
};

test("parser returns the exact values padded into a 140-char line", () => {
  const line = buildLine(sample);
  assert.equal(line.length, 140);
  const r = parseIndexLine(line);
  assert.ok(r.ok);
  assert.deepEqual(r.row, {
    solicitation: "SPE1C127Q0127", pr: "7018634838", nsn: "8455011456344", is_nsn: true, fsc: "8455",
    item: "SERVICE RIBBON,AWAR", qty: 24000, uom: "EA", return_by: "2026-11-24",
    set_aside: "N", item_type: "1", buy_letter: "Q",
  });
});

test("part-number item has no FSC", () => {
  const r = parseIndexLine(buildLine({ ...sample, nsn: "1ABC5 MS28775-012", item_type: "2" }));
  assert.ok(r.ok);
  assert.equal(r.row.is_nsn, false);
  assert.equal(r.row.fsc, null);
  assert.equal(r.row.nsn, "1ABC5 MS28775-012");
});

test("invalid lines are rejected with a reason", () => {
  const bad = (f: Partial<typeof sample>) => parseIndexLine(buildLine({ ...sample, ...f }));
  assert.match((parseIndexLine("short") as { reason: string }).reason, /too short/);
  assert.match((bad({ solicitation: "spe1c1-27-q01" }) as { reason: string }).reason, /solicitation/);
  assert.match((bad({ return_by: "13/45/26" }) as { reason: string }).reason, /date/);
  assert.match((bad({ qty: "00A4000" }) as { reason: string }).reason, /quantity/);
});

test("helpers", () => {
  assert.equal(parseMdy("02/30/26"), null);
  assert.deepEqual(parseCsvLine('"A","B,1","","say ""hi""",""'), ["A", "B,1", "", 'say "hi"', ""]);
  assert.throws(() => assertIsData("<!DOCTYPE html>", "x"));
  assert.throws(() => assertIsData("... File was not found ...", "x"));
  assert.equal(setAsideLabel("Z"), "Unknown");
  assert.equal(setAsideLabel("N"), "None");
  assert.equal(formatNsn("8455011456344"), "8455-01-145-6344");
  assert.equal(formatSolicitation("SPE1C127Q0127"), "SPE1C1-27-Q-0127");
  assert.equal(normalizeNsn("8455-01-145-6344"), "8455011456344");
});

test("email draft check flags a missing or changed fact", async () => {
  const { checkDraft } = await import("../lib/ai");
  const facts = { nsn: "4720-00-456-2967", item: "HOSE", quantity: "30 EA", due: "November 24, 2026", sources: [] };
  assert.deepEqual(checkDraft("NSN 4720-00-456-2967, 30 EA, reply before November 24, 2026.", facts), []);
  const w = checkDraft("NSN 4720-00-456-2976, 300 EA needed by Nov 24.", facts);
  assert.equal(w.length, 3);
});

test("redirects to plain http on a DLA host are kept on https", async () => {
  const { redirectTarget } = await import("../lib/dibbs");
  const from = "https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in261123.txt";
  assert.equal(redirectTarget("http://dibbs2.bsm.dla.mil/dodwarning.aspx?goto=%2fx", from), "https://dibbs2.bsm.dla.mil/dodwarning.aspx?goto=%2fx");
  assert.equal(redirectTarget("http://dibbs2.bsm.dla.mil:80/a", from), "https://dibbs2.bsm.dla.mil/a");
  assert.equal(redirectTarget("../../../dodwarning.aspx?goto=1", from), "https://dibbs2.bsm.dla.mil/dodwarning.aspx?goto=1");
  assert.equal(redirectTarget("http://example.com/a", from), "http://example.com/a"); // other hosts untouched
});
