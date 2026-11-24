"use client";

import { useCallback, useEffect, useState } from "react";
import ProfilePanel from "@/components/ProfilePanel";
import { TIER_LABELS, TIER_SHORT, type Profile, type RfqGroup, type RfqResponse, type Summary } from "@/lib/match";
import { dibbsUrl, formatNsn, formatSolicitation, setAsideLabel } from "@/lib/parse";

type View = "matches" | "all";
type Filter = "all" | "due" | 1 | 2 | 3 | 4;
const DUE_SOON_DAYS = 2;

const fmtDate = (ymd: string) =>
  new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "in 1 day" : `in ${n} days`);

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request failed");
  return j as T;
}

const TIER_STYLE: Record<number, string> = {
  1: "bg-emerald-700 text-white",
  2: "bg-emerald-100 text-emerald-900",
  3: "bg-sky-100 text-sky-900",
  4: "bg-zinc-100 text-zinc-800",
};

function Why({ r }: { r: RfqGroup }) {
  if (r.tier == null) {
    return <span className="text-xs text-zinc-400">{r.eligible ? "—" : "Set-aside you don't hold"}</span>;
  }
  return (
    <div>
      <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 text-xs font-medium ${TIER_STYLE[r.tier]}`}>{TIER_LABELS[r.tier]}</span>
      <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-zinc-600">
        {r.r_part && <span className="border border-zinc-300 px-1">part on your list</span>}
        {r.cages.length > 0 && <span className="border border-zinc-300 px-1">approved source: <span className="font-mono">{r.cages.join(", ")}</span></span>}
        {r.r_class && <span className="border border-zinc-300 px-1">class {r.fsc}</span>}
      </div>
    </div>
  );
}

type EmailState = { row: RfqGroup; kind: "loading" | "done" | "error"; draft?: string; warnings?: string[]; msg?: string };

function EmailDialog({ state, onClose }: { state: EmailState; onClose: () => void }) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setText(state.draft ?? ""); setCopied(false); }, [state.draft]);
  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center bg-black/30 p-6" onClick={onClose}>
      <div role="dialog" aria-label="Supplier email draft" className="w-full max-w-2xl border border-zinc-400 bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <b>Supplier email draft</b>
          <span className="font-mono text-xs text-zinc-600">{formatSolicitation(state.row.solicitation)} · {formatNsn(state.row.nsn)}</span>
        </div>
        {state.kind === "loading" && <p className="py-8 text-center text-zinc-500">Drafting…</p>}
        {state.kind === "error" && <p className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-red-800">{state.msg}</p>}
        {state.kind === "done" && (
          <>
            {state.warnings && state.warnings.length > 0 && (
              <div className="mt-2 border border-amber-400 bg-amber-50 px-3 py-2 text-amber-900">
                <b>Check before sending.</b> The draft does not match the RFQ: {state.warnings.join(" ")}
              </div>
            )}
            <textarea value={text} onChange={(e) => { setText(e.target.value); setCopied(false); }} rows={14}
              aria-label="Email draft" className="mt-2 w-full border border-zinc-300 p-2 font-mono text-xs" />
            <p className="text-xs text-zinc-500">Written by AI from this row&apos;s facts only. Read it before you send it; this app never sends email.</p>
          </>
        )}
        <div className="mt-3 flex items-center gap-3">
          {state.kind === "done" && (
            <button type="button" className="bg-zinc-900 px-3 py-1 text-white"
              onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}>
              Copy
            </button>
          )}
          {copied && <span className="text-green-700">Copied</span>}
          <button type="button" className="ml-auto border border-zinc-300 px-3 py-1" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Badges({ r }: { r: RfqGroup }) {
  const b = "inline-block whitespace-nowrap px-1.5 py-0.5 text-xs";
  return (
    <div className="flex gap-1">
      {r.days_left <= DUE_SOON_DAYS && <span className={`${b} bg-red-600 font-medium text-white`}>Due soon</span>}
      {r.fast_award && <span className={`${b} border border-amber-400 text-amber-800`} title="Can be awarded before the deadline.">Fast Award</span>}
      {r.extended && <span className={`${b} border border-violet-400 text-violet-800`}>Deadline extended</span>}
      {r.is_new && <span className={`${b} border border-blue-400 text-blue-800`}>New</span>}
    </div>
  );
}

export default function Page() {
  const [view, setView] = useState<View>("matches");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState(""); // debounced search text
  const [data, setData] = useState<RfqResponse | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [email, setEmail] = useState<EmailState | null>(null);
  const [pull, setPull] = useState<{ kind: "idle" | "running" | "done" | "error"; msg?: string }>({ kind: "idle" });
  const pullData = useCallback(async () => {
    setPull({ kind: "running" });
    try {
      const r = await fetch("/api/pull", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not pull data.");
      setPull({ kind: "done", msg: j.message });
      if (j.days.length > 0) { setPage(1); setVersion((v) => v + 1); } // show the new data
    } catch (e) {
      setPull({ kind: "error", msg: (e as Error).message });
    }
  }, []);
  const draftEmail = useCallback(async (row: RfqGroup) => {
    setEmail({ row, kind: "loading" });
    try {
      const r = await fetch("/api/ai/email", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ solicitation: row.solicitation, nsn: row.nsn }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not draft the email.");
      setEmail((cur) => (cur?.row === row ? { row, kind: "done", draft: j.draft, warnings: j.warnings } : cur));
    } catch (e) {
      setEmail((cur) => (cur?.row === row ? { row, kind: "error", msg: (e as Error).message } : cur));
    }
  }, []); // bump to refetch after a profile save

  useEffect(() => {
    getJson<Profile>("/api/profile").then(setProfile).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    getJson<Summary>("/api/summary").then(setSummary).catch((e) => setError(e.message));
  }, [version]);

  useEffect(() => {
    const t = setTimeout(() => { setQ(searchText.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    getJson<RfqResponse>(`/api/rfqs?view=${view}&page=${page}` +
      (view === "matches" && typeof filter === "number" ? `&tier=${filter}` : "") +
      (view === "matches" && filter === "due" ? `&due=${DUE_SOON_DAYS}` : "") +
      (q ? `&q=${encodeURIComponent(q)}` : ""))
      .then((j) => { if (!stale) { setData(j); setError(null); } })
      .catch((e) => { if (!stale) setError(e.message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [view, filter, page, q, version]);

  const show = useCallback((v: View, f: Filter = "all") => { setView(v); setFilter(f); setPage(1); }, []);
  const onSaved = useCallback((p: Profile) => { setProfile(p); setFilter("all"); setPage(1); setVersion((v) => v + 1); }, []);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const tab = (v: View, label: string) => (
    <button type="button" onClick={() => show(v)}
      className={`-mb-px border border-b-0 px-3 py-1 ${view === v ? "border-zinc-300 bg-white font-semibold" : "border-transparent text-zinc-600 hover:text-zinc-900"}`}>
      {label}
    </button>
  );
  const num = (n: number, onClick: () => void) => (
    <button type="button" onClick={onClick} className="font-semibold text-blue-700 underline decoration-dotted">{n.toLocaleString()}</button>
  );

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6">
        <h1 className="text-lg font-semibold">DIBBS RFQ Finder</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {pull.kind !== "idle" && pull.kind !== "running" && (
          <span role="status" className={`text-xs ${pull.kind === "error" ? "text-red-700" : "text-green-700"}`}>{pull.msg}</span>
        )}
        {summary && (
          <p className="text-xs text-zinc-600">
            {summary.latest_post_date ? (
              <>
                Data through {fmtDate(summary.latest_post_date)} · {summary.total_lines.toLocaleString()} lines loaded from{" "}
                {summary.ingest.files} daily {summary.ingest.files === 1 ? "file" : "files"} ·{" "}
                <span className={summary.ingest.skipped ? "font-semibold text-red-700" : ""}>
                  {summary.ingest.skipped.toLocaleString()} skipped
                </span>
              </>
            ) : (
              "No data loaded yet."
            )}
          </p>
        )}
        <button type="button" onClick={pullData} disabled={pull.kind === "running"}
          title="Downloads any daily files newer than what is loaded, straight from DIBBS, and loads them. Accepts the DIBBS consent notice for you. Safe to repeat: existing lines are not duplicated."
          className="border border-zinc-400 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-60">
          {pull.kind === "running" ? "Pulling from DIBBS…" : "Pull latest data"}
        </button>
        </div>
      </div>

      {error && <p className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-red-800">{error}</p>}

      <div className="mt-3">{profile && <ProfilePanel initial={profile} onSaved={onSaved} />}</div>

      {summary && (
        <p className="mt-3 border border-zinc-300 bg-zinc-50 px-3 py-2 text-base">
          {num(summary.open_groups, () => show("all"))} open → {num(summary.matched_groups, () => show("matches"))} match your business
          {" "}→ {num(summary.matched_due2, () => show("matches", "due"))} due within 2 days
        </p>
      )}

      <div className="mt-4 flex items-end gap-1 border-b border-zinc-300">
        {tab("matches", "For you")}
        {tab("all", "All open RFQs")}
        <div className="mb-1 ml-auto flex items-center gap-1">
          <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            aria-label="Search" placeholder="Search solicitation, NSN, PR or item"
            className="w-72 border border-zinc-300 px-2 py-0.5" />
        </div>
      </div>

      {view === "matches" && summary && (
        <div className="flex flex-wrap gap-1.5 border border-t-0 border-zinc-300 px-2 py-2">
          {([
            ["all", "All matches", summary.matched_groups],
            [1, TIER_SHORT[1], summary.tiers[1]],
            [2, TIER_SHORT[2], summary.tiers[2]],
            [3, TIER_SHORT[3], summary.tiers[3]],
            [4, TIER_SHORT[4], summary.tiers[4]],
            ["due", "Due within 2 days", summary.matched_due2],
          ] as [Filter, string, number][]).map(([f, label, count]) => (
            <button key={String(f)} type="button" onClick={() => show("matches", f)}
              title={typeof f === "number" ? TIER_LABELS[f] : undefined}
              className={`rounded-full border px-2.5 py-0.5 ${filter === f ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-100"}`}>
              {label} <span className={filter === f ? "text-zinc-300" : "text-zinc-500"}>{count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto border border-t-0 border-zinc-300">
        <table className="w-full border-collapse text-left">
          <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600">
            <tr>
              <th className="px-2 py-1.5">Why</th>
              <th className="px-2 py-1.5">Solicitation</th>
              <th className="px-2 py-1.5">NSN / part</th>
              <th className="px-2 py-1.5">Item</th>
              <th className="px-2 py-1.5 text-right">Qty</th>
              <th className="px-2 py-1.5">Due</th>
              <th className="px-2 py-1.5">Set-aside</th>
              <th className="px-2 py-1.5">Badges</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody className={loading ? "opacity-50" : ""}>
            {data?.rows.map((r) => (
              <tr key={`${r.solicitation}|${r.nsn}`} className="border-t border-zinc-200 align-top hover:bg-zinc-50">
                <td className="px-2 py-1"><Why r={r} /></td>
                <td className="whitespace-nowrap px-2 py-1 font-mono">
                  <a href={dibbsUrl(r.solicitation)} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                    {formatSolicitation(r.solicitation)}
                  </a>
                </td>
                <td className="whitespace-nowrap px-2 py-1 font-mono">{formatNsn(r.nsn)}</td>
                <td className="px-2 py-1">{r.item}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right">
                  {r.total_qty.toLocaleString()} {r.uom}
                  {r.line_count > 1 && <div className="text-xs text-zinc-500">{r.line_count} lines</div>}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {fmtDate(r.return_by)} <span className="text-xs text-zinc-500">{inDays(r.days_left)}</span>
                </td>
                <td className="px-2 py-1 text-xs">{setAsideLabel(r.set_aside)}</td>
                <td className="px-2 py-1"><Badges r={r} /></td>
                <td className="whitespace-nowrap px-2 py-1">
                  {r.tier != null && r.has_source && (
                    <button type="button" onClick={() => draftEmail(r)} className="border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-100">
                      Draft supplier email
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!data && loading && (
              <tr><td colSpan={9} className="px-2 py-6 text-center text-zinc-500">Loading…</td></tr>
            )}
            {data && data.rows.length === 0 && (
              <tr><td colSpan={9} className="px-2 py-6 text-center text-zinc-500">
                {q
                  ? `Nothing found for "${q}"${view === "matches" ? " in your matches. Try the All open RFQs tab." : "."}`
                  : view === "matches" && filter !== "all"
                  ? "No matches under this filter."
                  : view === "matches"
                  ? "Nothing matches your profile yet. Add product classes, manufacturers or parts above, or look at All open RFQs."
                  : "No open RFQs. Run the ingest (npm run ingest) to load daily files."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="mt-2 flex items-center gap-3 text-zinc-600">
          <button className="border border-zinc-300 px-2 py-0.5 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span>Page {data.page} of {pages} · {data.total.toLocaleString()} RFQs</span>
          <button className="border border-zinc-300 px-2 py-0.5 disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}

      {email && <EmailDialog state={email} onClose={() => setEmail(null)} />}

      <p className="mt-6 text-xs text-zinc-500">
        Daily files run about a day behind DIBBS and carry no status: a cancelled or awarded RFQ can still show here.
        Open the solicitation link for live status.
      </p>
    </main>
  );
}
