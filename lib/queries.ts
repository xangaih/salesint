import { db, todayNY } from "./db";
import { normalizeNsn } from "./parse";
import { PROFILE_SET_ASIDES, type Profile, type RfqGroup, type RfqResponse, type Summary } from "./match";

export const PAGE_SIZE = 50;
export const DUE_SOON_DAYS = 2;

/**
 * Open RFQs, one row per (solicitation, nsn), with eligibility, reasons and tier.
 * Plain SQL against the profile arrays and approved_sources: exact and explainable.
 * A group's NSN is the same on every line, so reasons are computed per group;
 * eligibility is per line (set-aside) and a group is eligible if any line is.
 */
function groupsCte(today: string) {
  const sql = db();
  return sql`
    p as (
      select coalesce((select fscs from profile where id = 1), '{}')            as fscs,
             coalesce((select cages from profile where id = 1), '{}')           as cages,
             coalesce((select nsns from profile where id = 1), '{}')            as nsns,
             coalesce((select small_business from profile where id = 1), false) as small_business,
             coalesce((select set_asides from profile where id = 1), '{}')      as set_asides
    ),
    latest as (select max(last_posted) as d, count(distinct post_date)::int as days
               from (select last_posted, last_posted as post_date from rfq_lines
                     union all select first_posted, first_posted from rfq_lines) x),
    g0 as (
      select l.solicitation, l.nsn,
             bool_and(l.is_nsn)                 as is_nsn,
             min(l.fsc)                         as fsc,
             min(l.item)                        as item,
             sum(l.qty)::int                    as total_qty,
             min(l.uom)                         as uom,
             count(*)::int                      as line_count,
             min(l.return_by)                   as return_by,
             min(l.set_aside)                   as set_aside,
             string_agg(l.pr, ' ')              as prs,
             bool_or(l.set_aside = 'N'
                     or (l.set_aside = 'Y' and p.small_business)
                     or l.set_aside = any(p.set_asides)) as eligible,
             bool_or(l.buy_type = 'F')          as fast_award,
             bool_or(l.prev_return_by is not null) as extended,
             bool_or(l.first_posted = latest.d) and min(latest.days) > 1 as is_new
      from rfq_lines l cross join p cross join latest
      where l.return_by >= ${today}::date
      group by l.solicitation, l.nsn
    ),
    g1 as (
      select g0.*,
             (g0.return_by - ${today}::date)::int       as days_left,
             g0.nsn = any(p.nsns)                       as r_part,
             coalesce(g0.fsc = any(p.fscs), false)      as r_class,
             coalesce((select array_agg(distinct a.cage order by a.cage)
                       from approved_sources a
                       where a.nsn = g0.nsn and a.cage = any(p.cages)), '{}') as cages,
             exists (select 1 from approved_sources a where a.nsn = g0.nsn) as has_source
      from g0 cross join p
    ),
    g as (
      select g1.*,
             case when not eligible then null
                  when r_part then 1
                  when cardinality(cages) > 0 and r_class then 2
                  when cardinality(cages) > 0 then 3
                  when r_class then 4
             end as tier
      from g1
    )`;
}

export type ListParams = { view: "matches" | "all"; tier?: number; due?: number; q?: string; page: number };

export async function listGroups({ view, tier, due, q, page }: ListParams): Promise<RfqResponse> {
  const sql = db();
  const today = todayNY();
  const p = Math.max(1, page);
  // Search ignores dashes, spaces and case: 8455-01-145-6344 finds 8455011456344.
  const needle = (q ?? "").replace(/[-\s]/g, "").toUpperCase();
  const like = "%" + needle.replace(/[\\%_]/g, "\\$&") + "%";
  const strip = (col: ReturnType<typeof sql>) => sql`upper(regexp_replace(${col}, '[-[:space:]]', '', 'g'))`;

  const where = sql`
    where true
      ${view === "matches" ? sql`and tier is not null` : sql``}
      ${tier ? sql`and tier = ${tier}` : sql``}
      ${due != null ? sql`and days_left <= ${due}` : sql``}
      ${needle
        ? sql`and (solicitation like ${like} or ${strip(sql`nsn`)} like ${like}
                   or ${strip(sql`prs`)} like ${like} or ${strip(sql`coalesce(item, '')`)} like ${like})`
        : sql``}`;

  const rows = await sql<RfqGroup[]>`
    with ${groupsCte(today)}
    select solicitation, nsn, is_nsn, fsc, item, total_qty, uom, line_count,
           return_by::text as return_by, days_left, set_aside, eligible, tier,
           r_part, r_class, cages, has_source, fast_award, extended, is_new
    from g ${where}
    order by tier nulls last, return_by, total_qty desc, solicitation, nsn
    limit ${PAGE_SIZE} offset ${(p - 1) * PAGE_SIZE}`;
  const [{ total }] = await sql<{ total: number }[]>`
    with ${groupsCte(today)} select count(*)::int as total from g ${where}`;
  return { today, page: p, page_size: PAGE_SIZE, total, rows };
}

export async function getSummary(): Promise<Summary> {
  const sql = db();
  const today = todayNY();
  const [s] = await sql`
    with ${groupsCte(today)}
    select count(*)::int                                            as open_groups,
           count(*) filter (where tier is not null)::int            as matched_groups,
           count(*) filter (where tier is not null and days_left <= ${DUE_SOON_DAYS})::int as matched_due2,
           count(*) filter (where tier = 1)::int as t1,
           count(*) filter (where tier = 2)::int as t2,
           count(*) filter (where tier = 3)::int as t3,
           count(*) filter (where tier = 4)::int as t4
    from g`;
  const [i] = await sql`
    select count(*)::int as files, coalesce(sum(lines_read), 0)::int as lines_read,
           coalesce(sum(rows_loaded), 0)::int as rows_loaded, coalesce(sum(skipped), 0)::int as skipped,
           max(post_date)::text as latest_post_date, count(distinct post_date)::int as post_days
    from ingest_runs`;
  const [{ total_lines }] = await sql`select count(*)::int as total_lines from rfq_lines`;
  return {
    today,
    open_groups: s.open_groups,
    matched_groups: s.matched_groups,
    matched_due2: s.matched_due2,
    tiers: { 1: s.t1, 2: s.t2, 3: s.t3, 4: s.t4 },
    latest_post_date: i.latest_post_date,
    post_days: i.post_days,
    ingest: { files: i.files, lines_read: i.lines_read, rows_loaded: i.rows_loaded, skipped: i.skipped },
    total_lines,
  };
}

const EMPTY_PROFILE: Profile = {
  name: "My business", description: "", fscs: [], cages: [], nsns: [], small_business: true, set_asides: [],
};

export async function getProfile(): Promise<Profile> {
  const [row] = await db()<Profile[]>`
    select name, description, fscs, cages, nsns, small_business, set_asides from profile where id = 1`;
  return row ?? EMPTY_PROFILE;
}

/** Validate and normalize untrusted input. Returns the clean profile or a list of problems. */
export function cleanProfile(input: unknown): { profile: Profile } | { errors: string[] } {
  const b = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  const uniq = (a: string[]) => [...new Set(a)];

  const name = typeof b.name === "string" ? b.name.trim().slice(0, 200) : "";
  if (!name) errors.push("Business name is required.");
  const fscs = uniq(list(b.fscs));
  for (const f of fscs) if (!/^\d{4}$/.test(f)) errors.push(`Product class "${f}" must be 4 digits.`);
  const cages = uniq(list(b.cages).map((c) => c.toUpperCase()));
  for (const c of cages) if (!/^[A-Z0-9]{5}$/.test(c)) errors.push(`CAGE "${c}" must be 5 letters or digits.`);
  const nsns = uniq(list(b.nsns).map(normalizeNsn));
  for (const n of nsns) if (!/^\d{13}$/.test(n)) errors.push(`Part "${n}" is not a 13-digit NSN.`);
  const set_asides = uniq(list(b.set_asides).map((s) => s.toUpperCase()));
  for (const s of set_asides)
    if (!(PROFILE_SET_ASIDES as readonly string[]).includes(s)) errors.push(`Unknown set-aside "${s}".`);
  if (fscs.length > 500 || cages.length > 500 || nsns.length > 20000) errors.push("Too many entries.");

  if (errors.length) return { errors: errors.slice(0, 10) };
  return {
    profile: {
      name,
      description: typeof b.description === "string" ? b.description.slice(0, 2000) : "",
      fscs, cages, nsns, set_asides,
      small_business: b.small_business === true,
    },
  };
}

export async function saveProfile(p: Profile): Promise<Profile> {
  const sql = db();
  await sql`
    insert into profile (id, name, description, fscs, cages, nsns, small_business, set_asides)
    values (1, ${p.name}, ${p.description}, ${p.fscs}, ${p.cages}, ${p.nsns}, ${p.small_business}, ${p.set_asides})
    on conflict (id) do update set
      name = excluded.name, description = excluded.description, fscs = excluded.fscs, cages = excluded.cages,
      nsns = excluded.nsns, small_business = excluded.small_business, set_asides = excluded.set_asides`;
  return getProfile(); // read back what the database actually holds
}

export type CageSuggestion = { cage: string; open_in_classes: number; open_total: number };

/**
 * Manufacturers focused on the given product classes. Among CAGEs with at least 5 open lines,
 * keep those where at least 60% of their open lines fall inside the classes, ordered by open
 * lines in those classes. (Taking the CAGEs with the most lines would pick huge suppliers
 * approved across dozens of unrelated classes.)
 */
export async function suggestCages(fscs: string[], limit = 12, sql = db()): Promise<CageSuggestion[]> {
  if (fscs.length === 0) return [];
  return sql<CageSuggestion[]>`
    with cage_lines as (
      select distinct a.cage, l.solicitation, l.pr, l.nsn, l.fsc
      from rfq_lines l join approved_sources a on a.nsn = l.nsn
      where l.return_by >= ${todayNY()}::date
    )
    select cage,
           count(*) filter (where fsc = any(${fscs}))::int as open_in_classes,
           count(*)::int                                   as open_total
    from cage_lines
    group by cage
    having count(*) >= 5
       and count(*) filter (where fsc = any(${fscs})) >= 0.6 * count(*)
    order by open_in_classes desc, open_total, cage
    limit ${limit}`;
}
