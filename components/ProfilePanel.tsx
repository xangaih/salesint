"use client";

import { useEffect, useState } from "react";
import { PROFILE_SET_ASIDES, type Profile } from "@/lib/match";
import { normalizeNsn, setAsideLabel } from "@/lib/parse";

type FscSuggestion = { fsc: string; reason: string; examples: string[] };
type CageSuggestion = { cage: string; open_in_classes: number; open_total: number };

function Chips({ label, hint, values, onChange, pattern, upper, children }: {
  label: string; hint: string; values: string[]; onChange: (v: string[]) => void; pattern: RegExp; upper?: boolean;
  children?: React.ReactNode;
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
      {children}
    </div>
  );
}

export default function ProfilePanel({ initial, onSaved }: { initial: Profile; onSaved: (p: Profile) => void }) {
  const [open, setOpen] = useState(true);
  const [p, setP] = useState<Profile>(initial);
  const [nsnText, setNsnText] = useState(initial.nsns.join("\n"));
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; msg?: string }>({ kind: "idle" });
  const [suggested, setSuggested] = useState<CageSuggestion[]>([]);
  const fscKey = p.fscs.join(",");
  useEffect(() => {
    if (!fscKey) return setSuggested([]);
    let stale = false;
    fetch(`/api/cages?fscs=${fscKey}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => { if (!stale) setSuggested(j); })
      .catch(() => { if (!stale) setSuggested([]); });
    return () => { stale = true; };
  }, [fscKey]);
  const [ai, setAi] = useState<{ kind: "idle" | "loading" | "done" | "error"; msg?: string; items: FscSuggestion[] }>({ kind: "idle", items: [] });
  const suggest = async () => {
    setAi({ kind: "loading", items: [] });
    try {
      const r = await fetch("/api/ai/suggest", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: p.description }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not get suggestions.");
      setAi({ kind: "done", items: j.suggestions });
    } catch (e) {
      setAi({ kind: "error", msg: (e as Error).message, items: [] });
    }
  };
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
          <div className="md:col-span-2">
            <div className="font-medium">Describe your business <span className="font-normal text-zinc-500">(optional, a sentence or two; AI suggests product classes for you to confirm)</span></div>
            <div className="mt-1 flex items-start gap-2">
              <textarea value={p.description} onChange={(e) => edit({ description: e.target.value })} rows={2} aria-label="Business description"
                className="w-full border border-zinc-300 px-2 py-1" placeholder="We distribute hydraulic hose assemblies, tube fittings and seals for ground vehicles." />
              <button type="button" onClick={suggest} disabled={ai.kind === "loading" || p.description.trim().length < 10}
                className="whitespace-nowrap border border-zinc-400 px-2 py-1 hover:bg-zinc-100 disabled:opacity-50">
                {ai.kind === "loading" ? "Thinking…" : "Suggest classes"}
              </button>
            </div>
            {ai.kind === "error" && <p className="mt-1 text-red-700">{ai.msg}</p>}
            {ai.kind === "done" && ai.items.length === 0 && <p className="mt-1 text-zinc-600">No product class in the loaded data fits that description.</p>}
            {ai.items.length > 0 && (
              <div className="mt-1.5 border border-dashed border-zinc-400 p-2">
                <div className="text-xs text-zinc-600">AI suggestions. Tick the ones that fit, then click Save. Nothing is saved until you do.</div>
                {ai.items.map((s) => (
                  <label key={s.fsc} className="mt-1 flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5" checked={p.fscs.includes(s.fsc)}
                      onChange={(e) => edit({ fscs: e.target.checked ? [...p.fscs, s.fsc] : p.fscs.filter((x) => x !== s.fsc) })} />
                    <span>
                      <span className="font-mono font-medium">{s.fsc}</span> {s.reason}{" "}
                      <span className="text-xs text-zinc-500">e.g. {s.examples.join("; ")}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <Chips label="Product classes (FSC)" hint="4 digits" values={p.fscs} pattern={/^\d{4}$/} onChange={(fscs) => edit({ fscs })} />
          <Chips label="Manufacturers I carry (CAGE)" hint="5 characters" values={p.cages} pattern={/^[A-Z0-9]{5}$/} upper onChange={(cages) => edit({ cages })}>
            {suggested.some((c) => !p.cages.includes(c.cage)) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-zinc-600">
                <span title="Manufacturers with at least 5 open RFQ lines, 60% or more of them in your product classes">
                  Suggested for your classes:
                </span>
                {suggested.filter((c) => !p.cages.includes(c.cage)).map((c) => (
                  <button key={c.cage} type="button" onClick={() => edit({ cages: [...p.cages, c.cage] })}
                    title={`${c.open_in_classes} of ${c.open_total} open RFQ lines are in your classes`}
                    className="border border-dashed border-zinc-400 px-1.5 py-0.5 hover:bg-zinc-100">
                    + <span className="font-mono">{c.cage}</span> <span className="text-zinc-500">{c.open_in_classes} open</span>
                  </button>
                ))}
              </div>
            )}
          </Chips>
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
