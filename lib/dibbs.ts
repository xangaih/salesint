// Fetching DIBBS daily files. Server-only. DIBBS answers with a "DoD Warning and Consent"
// page until its form is submitted; callers choose whether that is allowed (acceptConsent).
import { unzipSync } from "fflate";

const BASE = "https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/";

type Resp = { url: string; res: Response; body: Buffer };

/**
 * Where to go for a redirect. DIBBS sits behind a load balancer and sometimes answers with a
 * redirect to a plain http:// address on its own host; its port 80 does not answer, so we stay on https.
 */
export function redirectTarget(location: string, from: string): string {
  const next = new URL(location, from);
  if (next.protocol === "http:" && next.hostname.endsWith(".dla.mil")) {
    next.protocol = "https:";
    next.port = "";
  }
  return next.toString();
}

export class DibbsSession {
  private cookies = new Map<string, string>();
  constructor(private acceptConsent: boolean, private log: (msg: string) => void = () => {}) {}

  /** fetch with a tiny cookie jar, following redirects by hand so cookies set on the way are kept. */
  /** Every request made, for diagnosis: "GET https://… -> 302 Location: …". Query strings are left out. */
  readonly trail: string[] = [];

  private async request(url: string, init: RequestInit = {}): Promise<Resp> {
    const short = (u: string) => u.split("?")[0];
    for (let hop = 0; hop < 6; hop++) {
      const method = init.method ?? "GET";
      const send = () => fetch(url, {
        ...init,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
        headers: {
          ...(init.headers as Record<string, string>),
          "user-agent": "dibbs-rfq-finder/1.0 (daily file download)",
          cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        },
      });
      // One retry on a dropped connection; DIBBS occasionally resets them.
      const res = await send().catch(async (e) => {
        this.log(`connection to DIBBS failed (${(e as Error).cause ?? (e as Error).message}); retrying once`);
        await new Promise((r) => setTimeout(r, 2000));
        return send().catch((e2) => {
          this.trail.push(`${method} ${short(url)} -> no answer`);
          throw new Error(`Could not reach DIBBS: ${(e2 as Error).cause ?? (e2 as Error).message}`);
        });
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      const loc = res.headers.get("location");
      this.trail.push(`${method} ${short(url)} -> ${res.status}${loc ? ` Location: ${short(loc)}` : ""} (${res.headers.get("content-type") ?? "no type"})`);
      if (res.status >= 300 && res.status < 400 && loc) {
        url = redirectTarget(loc, url);
        init = {}; // redirects become plain GETs
        continue;
      }
      return { url, res, body: Buffer.from(await res.arrayBuffer()) };
    }
    throw new Error(`Too many redirects for ${url}`);
  }

  /** Submit the consent form (the "OK" button). DIBBS answers it with the requested file itself. */
  private submitConsent(pageUrl: string, html: string): Promise<Resp> {
    const action = /<form[^>]*\baction="([^"]*)"/i.exec(html)?.[1];
    if (!action) throw new Error("DIBBS consent page layout changed: no form found.");
    const form = new URLSearchParams();
    for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
      const name = /\bname="([^"]*)"/i.exec(m[0])?.[1];
      const value = /\bvalue="([^"]*)"/i.exec(m[0])?.[1] ?? "";
      if (name) form.set(name, value.replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
    }
    form.set("butAgree", "OK");
    return this.request(new URL(action.replace(/&amp;/g, "&"), pageUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", referer: pageUrl },
      body: form.toString(),
    });
  }

  /** Returns validated file bytes, or null when DIBBS says the file does not exist. */
  async getFile(name: string): Promise<Buffer | null> {
    let r = await this.request(BASE + name);
    if (isConsent(r.body)) {
      if (!this.acceptConsent) {
        throw new Error(
          "DIBBS is showing its DoD Warning and Consent notice. Read it at https://www.dibbs.bsm.dla.mil/ and, " +
            "if you agree, re-run with --accept-consent."
        );
      }
      this.log(`${name}: consent notice shown; accepting it as instructed`);
      r = await this.submitConsent(r.url, r.body.toString("latin1"));
      if (isConsent(r.body)) throw new Error("Consent was submitted but DIBBS still shows the notice.");
    }
    if (isNotFound(r.body)) return null;
    if (!r.res.ok) throw new Error(`${name}: DIBBS answered HTTP ${r.res.status}`);
    validate(name, r.body);
    return r.body;
  }
}

const isConsent = (b: Buffer) => b.subarray(0, 4000).toString("latin1").includes("Warning and Consent");
const isNotFound = (b: Buffer) => b.subarray(0, 20000).toString("latin1").includes("File was not found");

/** Content checks: real data, not a web page. Throws with the reason. */
export function validate(name: string, b: Buffer) {
  if (name.endsWith(".zip")) {
    if (b.subarray(0, 2).toString("latin1") !== "PK") throw new Error(`${name}: not a zip file`);
    return;
  }
  if (b.subarray(0, 200).toString("latin1").trimStart().startsWith("<")) throw new Error(`${name}: got a web page, not data`);
  const first = b.toString("latin1").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  if (first.length < 137 || !/^[A-Z0-9]{13}$/.test(first.slice(0, 13))) {
    throw new Error(`${name}: first line does not look like an RFQ index line`);
  }
}

/** bqYYMMDD.txt and asYYMMDD.txt out of a batch zip, by lower-case name. Other entries are ignored. */
export function unzipBatchBuffer(zip: Buffer): Map<string, Buffer> {
  if (zip.subarray(0, 2).toString("latin1") !== "PK") throw new Error("Batch file is not a zip (probably a DIBBS web page).");
  const out = new Map<string, Buffer>();
  for (const [entry, bytes] of Object.entries(unzipSync(zip))) {
    const base = entry.split(/[\\/]/).pop()!.toLowerCase();
    if (/^(bq|as)\d{6}\.txt$/.test(base)) out.set(base, Buffer.from(bytes));
  }
  return out;
}

/** Candidate post dates (YYMMDD), newest first: weekdays going back from today in New York. */
export function recentWeekdays(maxDaysBack = 14): string[] {
  const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const d = new Date(ny + "T12:00:00Z");
  const out: string[] = [];
  for (let i = 0; i < maxDaysBack; i++, d.setUTCDate(d.getUTCDate() - 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(2, 10).replace(/-/g, ""));
  }
  return out;
}
