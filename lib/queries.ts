import { db, todayNY } from "./db";

export const PAGE_SIZE = 50;

export type RfqGroup = {
  solicitation: string;
  nsn: string;
  is_nsn: boolean;
  item: string | null;
  total_qty: number;
  uom: string | null;
  line_count: number;
  return_by: string; // earliest in the group, YYYY-MM-DD
  days_left: number;
  set_aside: string | null;
};

/** Open RFQs, one row per (solicitation, nsn). All SQL is parameterized. */
export async function listOpenGroups(page: number) {
  const sql = db();
  const today = todayNY();
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  const rows = await sql<RfqGroup[]>`
    select solicitation, nsn,
           bool_and(is_nsn)              as is_nsn,
           min(item)                     as item,
           sum(qty)::int                 as total_qty,
           min(uom)                      as uom,
           count(*)::int                 as line_count,
           min(return_by)::text          as return_by,
           (min(return_by) - ${today}::date)::int as days_left,
           min(set_aside)                as set_aside
    from rfq_lines
    where return_by >= ${today}::date
    group by solicitation, nsn
    order by min(return_by), sum(qty) desc, solicitation, nsn
    limit ${PAGE_SIZE} offset ${offset}`;
  const [{ total, lines }] = await sql<{ total: number; lines: number }[]>`
    select count(distinct (solicitation, nsn))::int as total, count(*)::int as lines
    from rfq_lines where return_by >= ${today}::date`;
  return { today, page: Math.max(1, page), page_size: PAGE_SIZE, total, lines, rows };
}
