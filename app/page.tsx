"use client";

import { useCallback, useEffect, useState } from "react";
import ProfilePanel from "@/components/ProfilePanel";
import { TIER_LABELS, type Profile, type RfqGroup, type RfqResponse, type Summary } from "@/lib/match";
import { dibbsUrl, formatNsn, formatSolicitation, setAsideLabel } from "@/lib/parse";

type View = "matches" | "all";

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
      <span className={`inline-block px-1.5 py-0.5 text-xs font-medium ${TIER_STYLE[r.tier]}`}>{TIER_LABELS[r.tier]}</span>
      <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-zinc-600">
        {r.r_part && <span className="border border-zinc-300 px-1">part on your list</span>}
        {r.cages.length > 0 && <span className="border border-zinc-300 px-1">approved source: <span className="font-mono">{r.cages.join(", ")}</span></span>}
        {r.r_class && <span className="border border-zinc-300 px-1">class {r.fsc}</span>}
      </div>
    </div>
  );
}

export default function Page() {
  const [view, setView] = useState<View>("matches");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RfqResponse | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0); // bump to refetch after a profile save

  useEffect(() => {
    getJson<Profile>("/api/profile").then(setProfile).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    getJson<Summary>("/api/summary").then(setSummary).catch((e) => setError(e.message));
  }, [version]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    getJson<RfqResponse>(`/api/rfqs?view=${view}&page=${page}`)
      .then((j) => { if (!stale) { setData(j); setError(null); } })
      .catch((e) => { if (!stale) setError(e.message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [view, page, version]);

  const show = useCallback((v: View) => { setView(v); setPage(1); }, []);
  const onSaved = useCallback((p: Profile) => { setProfile(p); setPage(1); setVersion((v) => v + 1); }, []);

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
    <main className="mx-auto max-w-6xl px-4 py-4">
      <h1 className="text-lg font-semibold">DIBBS RFQ Finder</h1>

      {error && <p className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-red-800">{error}</p>}

      <div className="mt-3">{profile && <ProfilePanel initial={profile} onSaved={onSaved} />}</div>

      {summary && (
        <p className="mt-3 border border-zinc-300 bg-zinc-50 px-3 py-2 text-base">
          {num(summary.open_groups, () => show("all"))} open → {num(summary.matched_groups, () => show("matches"))} match your business
          {" "}→ <b>{summary.matched_due2.toLocaleString()}</b> due within 2 days
        </p>
      )}

      <div className="mt-4 flex gap-1 border-b border-zinc-300">
        {tab("matches", "For you")}
        {tab("all", "All open RFQs")}
      </div>

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
                <td className="px-2 py-1 font-mono">{formatNsn(r.nsn)}</td>
                <td className="px-2 py-1">{r.item}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right">
                  {r.total_qty.toLocaleString()} {r.uom}
                  {r.line_count > 1 && <div className="text-xs text-zinc-500">{r.line_count} lines</div>}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {fmtDate(r.return_by)} <span className="text-xs text-zinc-500">{inDays(r.days_left)}</span>
                </td>
                <td className="px-2 py-1">{setAsideLabel(r.set_aside)}</td>
              </tr>
            ))}
            {!data && loading && (
              <tr><td colSpan={7} className="px-2 py-6 text-center text-zinc-500">Loading…</td></tr>
            )}
            {data && data.rows.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-6 text-center text-zinc-500">
                {view === "matches"
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

      <p className="mt-6 text-xs text-zinc-500">
        Daily files run about a day behind DIBBS and carry no status: a cancelled or awarded RFQ can still show here.
        Open the solicitation link for live status.
      </p>
    </main>
  );
}
