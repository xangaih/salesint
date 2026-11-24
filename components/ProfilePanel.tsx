"use client";

import { useState } from "react";
import { PROFILE_SET_ASIDES, type Profile } from "@/lib/match";
import { normalizeNsn, setAsideLabel } from "@/lib/parse";

function Chips({ label, hint, values, onChange, pattern, upper }: {
  label: string; hint: string; values: string[]; onChange: (v: string[]) => void; pattern: RegExp; upper?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const add = () => {
    const parts = draft.split(/[\s,]+/).map((s) => (upper ? s.toUpperCase() : s)).filter(Boolean);
    if (parts.length === 0) return;
    if (parts.some((p) => !pattern.test(p))) return setBad(true);
    onChange([...new Set([...values, ...parts])]);
    setDraft("");
    setBad(false);
  };
  return (
    <div>
      <div className="font-medium">{label}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs">
            {v}
            <button type="button" aria-label={`Remove ${v}`} className="text-zinc-500 hover:text-red-700"
              onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setBad(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={hint}
          className={`w-28 border px-1.5 py-0.5 text-xs ${bad ? "border-red-500" : "border-zinc-300"}`}
        />
        <button type="button" onClick={add} className="border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-100">Add</button>
        {bad && <span className="text-xs text-red-700">Expected {hint}</span>}
      </div>
    </div>
  );
}

export default function ProfilePanel({ initial, onSaved }: { initial: Profile; onSaved: (p: Profile) => void }) {
  const [open, setOpen] = useState(true);
  const [p, setP] = useState<Profile>(initial);
  const [nsnText, setNsnText] = useState(initial.nsns.join("\n"));
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; msg?: string }>({ kind: "idle" });
  const edit = (patch: Partial<Profile>) => { setP({ ...p, ...patch }); setStatus({ kind: "idle" }); };

  const save = async () => {
    setStatus({ kind: "saving" });
    const nsns = nsnText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map(normalizeNsn);
    try {
      const r = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...p, nsns }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Save failed");
      // Only now, with the server's copy in hand, do we say "Saved".
      setP(j);
      setNsnText(j.nsns.join("\n"));
      setStatus({ kind: "saved" });
      onSaved(j);
    } catch (e) {
      setStatus({ kind: "error", msg: (e as Error).message });
    }
  };

  return (
    <section className="border border-zinc-300">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between bg-zinc-100 px-3 py-1.5 text-left">
        <span>
          <b>Business profile</b>
          <span className="ml-2 text-zinc-600">
            {initial.name} · {initial.fscs.length} classes · {initial.cages.length} manufacturers · {initial.nsns.length} parts
          </span>
        </span>
        <span className="text-zinc-500">{open ? "Hide ▲" : "Edit ▼"}</span>
      </button>
      {open && (
        <div className="grid gap-3 p-3 md:grid-cols-2">
          <label className="block">
            <div className="font-medium">Business name</div>
            <input value={p.name} onChange={(e) => edit({ name: e.target.value })} className="mt-1 w-full border border-zinc-300 px-2 py-1" />
          </label>
          <div>
            <div className="font-medium">Set-asides I qualify for</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={p.small_business} onChange={(e) => edit({ small_business: e.target.checked })} />
                Small business
              </label>
              {PROFILE_SET_ASIDES.map((c) => (
                <label key={c} className="flex items-center gap-1">
                  <input type="checkbox" checked={p.set_asides.includes(c)}
                    onChange={(e) => edit({ set_asides: e.target.checked ? [...p.set_asides, c] : p.set_asides.filter((x) => x !== c) })} />
                  {setAsideLabel(c)}
                </label>
              ))}
            </div>
          </div>
          <Chips label="Product classes (FSC)" hint="4 digits" values={p.fscs} pattern={/^\d{4}$/} onChange={(fscs) => edit({ fscs })} />
          <Chips label="Manufacturers I carry (CAGE)" hint="5 characters" values={p.cages} pattern={/^[A-Z0-9]{5}$/} upper onChange={(cages) => edit({ cages })} />
          <label className="block md:col-span-2">
            <div className="font-medium">My parts <span className="font-normal text-zinc-500">(NSNs, one per line, dashes allowed)</span></div>
            <textarea value={nsnText} onChange={(e) => { setNsnText(e.target.value); setStatus({ kind: "idle" }); }} rows={3}
              className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs" placeholder="4720-01-234-5678" />
          </label>
          <div className="flex items-center gap-3 md:col-span-2">
            <button type="button" onClick={save} disabled={status.kind === "saving"}
              className="bg-zinc-900 px-3 py-1 text-white disabled:opacity-50">
              {status.kind === "saving" ? "Saving…" : "Save"}
            </button>
            {status.kind === "saved" && <span className="text-green-700">Saved</span>}
            {status.kind === "error" && <span className="text-red-700">{status.msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
