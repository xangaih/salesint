"use client";

import { useEffect, useState } from "react";
import { dibbsUrl, formatNsn, formatSolicitation, setAsideLabel } from "@/lib/parse";
import type { RfqGroup } from "@/lib/queries";

type RfqResponse = { today: string; page: number; page_size: number; total: number; lines: number; rows: RfqGroup[] };

const fmtDate = (ymd: string) =>
  new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "in 1 day" : `in ${n} days`);

export default function Page() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RfqResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    fetch(`/api/rfqs?view=all&page=${page}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Request failed");
        return j as RfqResponse;
      })
      .then((j) => { if (!stale) { setData(j); setError(null); } })
      .catch((e) => { if (!stale) setError(e.message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <h1 className="text-lg font-semibold">DIBBS RFQ Finder</h1>
      <p className="mt-1 text-zinc-600">
        {data ? (
          <>
            <b className="text-zinc-900">{data.total.toLocaleString()}</b> open RFQs ({data.lines.toLocaleString()} lines) ·
            due on or after {fmtDate(data.today)}
          </>
        ) : (
          "All open RFQs"
        )}
      </p>

      {error && <p className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-red-800">{error}</p>}

      <div className="mt-3 overflow-x-auto border border-zinc-300">
        <table className="w-full border-collapse text-left">
          <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600">
            <tr>
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
              <tr key={`${r.solicitation}|${r.nsn}`} className="border-t border-zinc-200 hover:bg-zinc-50">
                <td className="whitespace-nowrap px-2 py-1 font-mono">
                  <a href={dibbsUrl(r.solicitation)} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                    {formatSolicitation(r.solicitation)}
                  </a>
                </td>
                <td className="px-2 py-1 font-mono">{formatNsn(r.nsn)}</td>
                <td className="px-2 py-1">{r.item}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right">
                  {r.total_qty.toLocaleString()} {r.uom}
                  {r.line_count > 1 && <span className="ml-1 text-xs text-zinc-500">· {r.line_count} lines</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {fmtDate(r.return_by)} <span className="text-xs text-zinc-500">{inDays(r.days_left)}</span>
                </td>
                <td className="px-2 py-1">{setAsideLabel(r.set_aside)}</td>
              </tr>
            ))}
            {!data && loading && (
              <tr><td colSpan={6} className="px-2 py-6 text-center text-zinc-500">Loading…</td></tr>
            )}
            {data && data.rows.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-6 text-center text-zinc-500">
                No open RFQs. Run the ingest (npm run ingest) to load daily files.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="mt-2 flex items-center gap-3 text-zinc-600">
          <button className="border border-zinc-300 px-2 py-0.5 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span>Page {data.page} of {pages}</span>
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
