// Pure parsing and formatting. No database, no AI. Slices are 0-based, end-exclusive.

export type RfqLine = {
  solicitation: string;
  pr: string;
  nsn: string;
  is_nsn: boolean;
  fsc: string | null;
  item: string;
  qty: number;
  uom: string;
  return_by: string; // YYYY-MM-DD
  set_aside: string;
  item_type: string;
  buy_letter: string;
};

export type ParseResult = { ok: true; row: RfqLine } | { ok: false; reason: string };

export const SET_ASIDE_LABELS: Record<string, string> = {
  N: "None",
  Y: "Small business",
  H: "HUBZone",
  R: "Service-disabled veteran-owned",
  L: "Women-owned",
  E: "Economically disadvantaged women-owned",
  A: "8(a)",
};

/** Unknown codes are shown as "Unknown", never as "None". */
export function setAsideLabel(code: string | null | undefined): string {
  return (code && SET_ASIDE_LABELS[code]) || "Unknown";
}

/** MM/DD/YY -> YYYY-MM-DD (20YY), or null when it is not a real date. */
export function parseMdy(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s);
  if (!m) return null;
  const mo = +m[1], d = +m[2], y = 2000 + +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${m[1]}-${m[2]}`;
}

export function parseIndexLine(line: string): ParseResult {
  if (line.length < 137) return { ok: false, reason: `line too short (${line.length} chars)` };
  const solicitation = line.slice(0, 13);
  if (!/^[A-Z0-9]{13}$/.test(solicitation)) return { ok: false, reason: "bad solicitation number" };
  const return_by = parseMdy(line.slice(72, 80));
  if (!return_by) return { ok: false, reason: `bad return-by date "${line.slice(72, 80)}"` };
  const qtyRaw = line.slice(99, 106).trim();
  if (!/^\d+$/.test(qtyRaw)) return { ok: false, reason: `bad quantity "${qtyRaw}"` };
  const nsn = line.slice(13, 59).trim();
  const item_type = line.slice(135, 136);
  const is_nsn = item_type === "1" && /^\d{13}$/.test(nsn);
  return {
    ok: true,
    row: {
      solicitation,
      pr: line.slice(59, 72).trim(),
      nsn,
      is_nsn,
      fsc: is_nsn ? nsn.slice(0, 4) : null,
      item: line.slice(108, 129).trim(),
      qty: parseInt(qtyRaw, 10),
      uom: line.slice(106, 108).trim(),
      return_by,
      set_aside: line.slice(136, 137),
      item_type,
      buy_letter: solicitation[8],
    },
  };
}

/** Throws when the content is a web page (consent notice / not found) and not data. */
export function assertIsData(content: string, fileName: string): void {
  if (
    content.trimStart().startsWith("<") ||
    content.includes("Warning and Consent") ||
    content.includes("File was not found")
  ) {
    throw new Error(
      `${fileName} is a web page, not data (DIBBS consent notice or "File was not found"). Nothing loaded.`
    );
  }
}

/** One CSV row where every field is double-quoted ("" is an escaped quote). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let v = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { v += '"'; i += 2; continue; }
          i++;
          break;
        }
        v += line[i++];
      }
      out.push(v);
      if (line[i] === ",") { i++; if (i === line.length) out.push(""); }
    } else {
      const j = line.indexOf(",", i);
      if (j === -1) { out.push(line.slice(i)); break; }
      out.push(line.slice(i, j));
      i = j + 1;
      if (i === line.length) out.push("");
    }
  }
  return out;
}

/** 8455-01-145-6344 -> 8455011456344 (only when the result is a 13-digit NSN). */
export function normalizeNsn(s: string): string {
  const t = s.trim();
  const digits = t.replace(/[-\s]/g, "");
  return /^\d{13}$/.test(digits) ? digits : t;
}

/** SPE1C127Q0127 -> SPE1C1-27-Q-0127 */
export function formatSolicitation(s: string): string {
  return s.length === 13 ? `${s.slice(0, 6)}-${s.slice(6, 8)}-${s.slice(8, 9)}-${s.slice(9)}` : s;
}

/** 8455011456344 -> 8455-01-145-6344 */
export function formatNsn(s: string): string {
  return /^\d{13}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 9)}-${s.slice(9)}` : s;
}

export function dibbsUrl(solicitation: string): string {
  return `https://www.dibbs.bsm.dla.mil/rfq/rfqrec.aspx?sn=${encodeURIComponent(solicitation)}`;
}
