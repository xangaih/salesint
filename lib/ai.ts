// Server-only. The two optional AI features. A person confirms both: suggestions are
// only ticked-and-saved by the user, and the email draft is only ever shown, never sent.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db, todayNY } from "./db";
import { formatNsn } from "./parse";

const MODEL = "claude-opus-5-5";

/** An error whose message is safe and short enough to show to the user. */
export class AiError extends Error {}

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiError("AI is not set up: ANTHROPIC_API_KEY is missing.");
  return new Anthropic();
}

function friendly(e: unknown): AiError {
  if (e instanceof AiError) return e;
  console.error(e);
  if (e instanceof Anthropic.AuthenticationError) return new AiError("AI key was rejected. Check ANTHROPIC_API_KEY.");
  if (e instanceof Anthropic.RateLimitError) return new AiError("AI is rate limited right now. Try again in a minute.");
  if (e instanceof Anthropic.APIConnectionError) return new AiError("Could not reach the AI service.");
  if (e instanceof Anthropic.APIError) return new AiError(`AI request failed (${e.status ?? "error"}).`);
  return new AiError("AI request failed.");
}

// ---- 9a. Describe your business -> suggested product classes ----

export type FscSuggestion = { fsc: string; reason: string; examples: string[] };

const SuggestionSchema = z.object({
  suggestions: z.array(z.object({ fsc: z.string(), reason: z.string() })),
});

/** Every FSC in the loaded data with its five most common item names: the closed list the model picks from. */
async function fscOptions(): Promise<Map<string, string[]>> {
  const rows = await db()<{ fsc: string; names: string[] }[]>`
    select fsc, array_agg(item order by n desc, item) as names
    from (select fsc, item, count(*) as n,
                 row_number() over (partition by fsc order by count(*) desc, item) as rk
          from rfq_lines where fsc is not null and item <> '' group by fsc, item) t
    where rk <= 5
    group by fsc order by fsc`;
  return new Map(rows.map((r) => [r.fsc, r.names]));
}

export async function suggestFscs(description: string): Promise<FscSuggestion[]> {
  const text = description.trim();
  if (text.length < 10) throw new AiError("Describe your business in a sentence or two first.");
  const options = await fscOptions();
  if (options.size === 0) throw new AiError("No RFQ data is loaded yet, so there are no product classes to suggest.");
  const list = [...options].map(([fsc, names]) => `${fsc}: ${names.join("; ")}`).join("\n");

  try {
    const response = await client().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system:
        "You help a small parts distributor set up a profile for finding U.S. Defense Logistics Agency RFQs. " +
        "You are given the distributor's description of its business and a closed list of Federal Supply Classes (FSC). " +
        "Each list line is a 4-digit FSC code followed by the most common item names currently on RFQs in that class " +
        "(names are cut off at 21 characters). Pick the classes this business most plausibly sells into: at most 8, " +
        "fewer when fewer fit, none when nothing fits. Use only codes from the list. For each, give a reason of one " +
        "short sentence that ties the description to the kind of items in that class. Order from best fit to weakest.",
      messages: [
        {
          role: "user",
          content: `<business_description>\n${text.slice(0, 2000)}\n</business_description>\n\n<fsc_list>\n${list}\n</fsc_list>`,
        },
      ],
      output_config: { effort: "low", format: zodOutputFormat(SuggestionSchema) },
    });
    if (response.stop_reason === "refusal") throw new AiError("The AI declined this request.");
    if (!response.parsed_output) throw new AiError("The AI returned an answer that could not be read.");
    const seen = new Set<string>();
    return response.parsed_output.suggestions
      .map((s) => ({ fsc: s.fsc.trim(), reason: s.reason.trim() }))
      // The model's output is checked in code: anything not in the closed list is dropped.
      .filter((s) => options.has(s.fsc) && !seen.has(s.fsc) && seen.add(s.fsc))
      .slice(0, 8)
      .map((s) => ({ ...s, examples: options.get(s.fsc)!.slice(0, 3) }));
  } catch (e) {
    throw friendly(e);
  }
}

// ---- 9b. Draft a supplier email for one RFQ ----

export type EmailFacts = {
  nsn: string;          // formatted, e.g. 4720-00-456-2967
  item: string;
  quantity: string;     // e.g. "30 EA"
  due: string;          // e.g. "November 24, 2026"
  sources: { cage: string; part_number: string }[];
};
export type EmailDraft = { draft: string; warnings: string[]; facts: EmailFacts };

/** The row's facts, read from the database on the server (never taken from the browser). */
async function emailFacts(solicitation: string, nsn: string): Promise<EmailFacts> {
  const sql = db();
  const [g] = await sql<{ item: string; total_qty: number; uom: string; return_by: string }[]>`
    select min(item) as item, sum(qty)::int as total_qty, min(uom) as uom, min(return_by)::text as return_by
    from rfq_lines
    where solicitation = ${solicitation} and nsn = ${nsn} and return_by >= ${todayNY()}::date
    having count(*) > 0`;
  if (!g) throw new AiError("That RFQ is no longer open.");
  // Prefer the manufacturers the vendor carries; otherwise every approved source for the part.
  const sources = await sql<{ cage: string; part_number: string; mine: boolean }[]>`
    select a.cage, a.part_number,
           a.cage = any(coalesce((select cages from profile where id = 1), '{}')) as mine
    from approved_sources a where a.nsn = ${nsn}
    order by mine desc, a.cage, a.part_number limit 40`;
  if (sources.length === 0) throw new AiError("This part has no approved source on file, so there is no one to ask.");
  const mine = sources.filter((s) => s.mine);
  const due = new Date(g.return_by + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  return {
    nsn: formatNsn(nsn),
    item: g.item,
    quantity: `${g.total_qty} ${g.uom}`,
    due,
    sources: (mine.length ? mine : sources).slice(0, 12).map(({ cage, part_number }) => ({ cage, part_number })),
  };
}

/** Code check, not AI: the three facts a wrong email would hurt most must appear exactly. */
export function checkDraft(draft: string, facts: EmailFacts): string[] {
  const warnings: string[] = [];
  if (!draft.includes(facts.nsn)) warnings.push(`NSN ${facts.nsn} is missing or different.`);
  if (!draft.includes(facts.quantity)) warnings.push(`Quantity "${facts.quantity}" is missing or different.`);
  if (!draft.includes(facts.due)) warnings.push(`Due date "${facts.due}" is missing or different.`);
  return warnings;
}

export async function draftSupplierEmail(solicitation: string, nsn: string): Promise<EmailDraft> {
  const facts = await emailFacts(solicitation, nsn);
  const factText = [
    `NSN: ${facts.nsn}`,
    `Item name (as listed, may be cut off): ${facts.item}`,
    `Quantity: ${facts.quantity}`,
    `Our quote to the customer is due: ${facts.due}`,
    `Approved manufacturer part(s):`,
    ...facts.sources.map((s) => `- CAGE ${s.cage}, part number ${s.part_number || "(not listed)"}`),
  ].join("\n");

  try {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 16000,
      system:
        "You draft a short request-for-quote email from a parts distributor to a supplier. Use only the facts given: " +
        "do not add prices, company names, contact names, contract terms, delivery addresses or anything else that is " +
        "not in the facts. Copy the NSN, the quantity and the due date exactly as written, character for character. " +
        "Ask for three things: unit price, lead time, and how long the quote is valid. Say when we need the reply by, " +
        "using the due date given. Keep it under 150 words, plain text, no markdown. Start with a 'Subject:' line, " +
        "open with 'Hello,' and end with the placeholder '[Your name]'. Output only the email.",
      messages: [{ role: "user", content: `<facts>\n${factText}\n</facts>` }],
      output_config: { effort: "low" },
    });
    if (response.stop_reason === "refusal") throw new AiError("The AI declined this request.");
    const draft = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!draft) throw new AiError("The AI returned an empty draft.");
    return { draft, warnings: checkDraft(draft, facts), facts };
  } catch (e) {
    throw friendly(e);
  }
}
