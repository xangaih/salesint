// Shared labels (safe for the browser: no database code here).

export const TIER_LABELS: Record<number, string> = {
  1: "Your part",
  2: "Strong: your manufacturer and your class",
  3: "Your manufacturer, outside your classes",
  4: "Your class",
};

export const TIER_SHORT: Record<number, string> = {
  1: "Your part",
  2: "Strong",
  3: "Your manufacturer",
  4: "Your class",
};

/** Set-asides a vendor can tick in the profile (N is open to all, Y is the small-business switch). */
export const PROFILE_SET_ASIDES = ["H", "R", "L", "E", "A"] as const;

export type Profile = {
  name: string;
  description: string;
  fscs: string[];
  cages: string[];
  nsns: string[];
  small_business: boolean;
  set_asides: string[];
};

export type RfqGroup = {
  solicitation: string;
  nsn: string;
  is_nsn: boolean;
  fsc: string | null;
  item: string | null;
  total_qty: number;
  uom: string | null;
  line_count: number;
  return_by: string; // earliest in the group, YYYY-MM-DD
  days_left: number;
  set_aside: string | null;
  eligible: boolean;
  tier: number | null; // null = not a match
  r_part: boolean;
  r_class: boolean;
  cages: string[]; // the vendor's CAGEs approved for this NSN
  has_source: boolean; // any approved source on file for this NSN
  fast_award: boolean;
  extended: boolean;
  is_new: boolean;
};

export type RfqResponse = {
  today: string;
  page: number;
  page_size: number;
  total: number;
  rows: RfqGroup[];
};

export type Summary = {
  today: string;
  open_groups: number;
  matched_groups: number;
  matched_due2: number;
  tiers: Record<string, number>;
  /** The same counts with the quantity range applied (equal to the above when no range is set). Used by the chips. */
  in_range: { matched_groups: number; matched_due2: number; tiers: Record<string, number> };
  latest_post_date: string | null;
  post_days: number;
  ingest: { files: number; lines_read: number; rows_loaded: number; skipped: number };
  total_lines: number;
};
