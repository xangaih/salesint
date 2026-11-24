# DIBBS RFQ Finder

DLA posts about 2,000 new RFQs on [DIBBS](https://www.dibbs.bsm.dla.mil/) every weekday. This tool pulls the
daily files and shows one vendor the RFQs that match their business, ranked, with the reason for each match.

## Run

1. Put `DATABASE_URL=<Postgres connection string>` in `.env.local` (Supabase: Connect → connection string). Never commit it.
2. `npm install`
3. `npm run schema` — creates the tables (safe to re-run).
4. `npm run download -- --accept-consent` — pulls the last 3 posting days into `./data/` (see below).
   Or put files there yourself: `inYYMMDD.txt`, and `bqYYMMDD.zip` or the unzipped `bq*.txt` / `as*.txt`.
5. `npm run ingest` — loads every `in*.txt` in `./data/`, oldest first (safe to re-run).
6. `npm run seed` — creates the sample profile (only if none exists; `-- --force` to reset it).
7. `npm run dev` and open http://localhost:3000

Optional: add `ANTHROPIC_API_KEY=...` to `.env.local` for the two AI features.

`npm test` runs the parser tests.

## How data is pulled

DIBBS has no API. It publishes files per posting day:

- `inYYMMDD.txt` — fixed-width index, one line per RFQ line (solicitation, NSN, PR, deadline, quantity, set-aside).
- `bqYYMMDD.zip` — holds `bq*.txt` (buy type per line, e.g. Fast Award) and `as*.txt` (approved manufacturers per NSN).

`scripts/download.ts` fetches these. DIBBS shows a "DoD Warning and Consent" notice first; the script accepts it
**only** when you pass `--accept-consent`, so that stays your decision. Both the consent page and a missing file
come back as HTML with HTTP 200, so every download is checked to be real data before it is saved.

**Pull latest data button.** The page header has a button that does the same thing from the browser: the server
downloads every posting day newer than what is loaded (the last 3 posting days when the database is empty), unzips
in memory and ingests. It accepts the consent notice automatically, by the owner's choice. It is safe to press
repeatedly: lines already loaded are not duplicated, new lines are added, and a changed deadline is recorded as an
extension. There is no login and no rate limit on it.

Why daily files and not page scraping: one request per day instead of about 50 slow search pages; the files are
complete (every line, not what a search happens to return); and the layout is stable.

## How vendors find opportunities

The vendor describes the business once in the **business profile**: product classes (FSC), manufacturers carried
(CAGE), specific parts (NSN), and the set-asides they qualify for. An open RFQ the vendor may bid on matches for
one or more **reasons**:

- **part** — the NSN is on the vendor's parts list;
- **manufacturer** — DLA's approved-sources file lists one of the vendor's CAGEs for that NSN;
- **class** — the NSN's product class is one of the vendor's.

Reasons give a **match tier**, the main sort (then deadline, then quantity):

| Tier | Label | Rule |
|---|---|---|
| 1 | Your part | part |
| 2 | Strong: your manufacturer and your class | manufacturer and class |
| 3 | Your manufacturer, outside your classes | manufacturer only |
| 4 | Your class | class only |

Tiers stop one large manufacturer from flooding the list. Only "due within 2 days" counts as urgent; Fast Award
is a small badge, because most lines are Fast Award.

**Grouping.** The database keeps one row per (solicitation, PR, NSN). The table shows one row per
(solicitation, NSN) with the total quantity and "N lines". Summary counts are groups; the data health line counts lines.

**Why rules and not AI for matching.** The data is exact codes, so matching is plain SQL (`lib/queries.ts`).
Every match is exact, repeatable, and comes with its reason. Item names are cut at 21 characters in the source,
so there is little language for a model to work with anyway.

## Optional AI (two places, both confirmed by a person)

Set `ANTHROPIC_API_KEY` in `.env.local` to turn these on. Without it, or if a call fails, the app shows a short
error and everything else keeps working. Both use the Anthropic TypeScript SDK on the server with `claude-opus-5-5`.

- **Describe your business → suggested product classes.** The model picks from a closed list: every product class
  in the loaded data, each with its five most common item names. Code drops any class not on that list. Suggestions
  are checkboxes; nothing is saved until you tick and click Save.
- **Draft supplier email** (matched rows with an approved source). The server sends only that row's facts: NSN,
  item name, total quantity and unit, due date, and the approved CAGE and part numbers. Code then checks that the
  NSN, quantity and due date appear in the draft exactly, and shows a warning above the draft if not. The app never sends email.

AI is not used in parsing, matching or ranking.

## How the data is trusted

- **Parser test** (`tests/parse.test.ts`): a 140-character line built from known values must parse back to exactly those values.
- **Counts in versus out**: each ingest prints and stores lines read, rows loaded and lines skipped, with a reason per skipped line (`ingest_runs`).
- **5% abort**: if more than 5% of a file's lines fail validation, nothing from that file is loaded; the format has probably changed.
- **Idempotent**: running the ingest twice changes nothing.
- **Web-page guard**: a file that is really an HTML page is rejected.
- **Spot-checks against DIBBS**: these checks prove the files were read faithfully, not that a row matches the
  live site. For that, open a few solicitation links and compare.

## Left out, and why

To keep the tool small and every result explainable: logins and multiple profiles; prices, award history, quoting
or submitting anything to DIBBS; downloading or parsing RFQ PDFs; scraping search pages or live status; charts,
exports, email sending, scheduled jobs; AI or fuzzy matching in parsing, matching or ranking.

## Known limits

- The daily files are about one day behind the website.
- The files carry no status: a cancelled or already-awarded RFQ can still show as open. Each row links to DIBBS, where the live status is.
- Item names are cut at 21 characters in the source, so matching uses product class, manufacturer and exact part, not keywords.
- The approved-sources file has no company names, only CAGE codes.
- One profile, no accounts.
- Checks prove the files were read faithfully. They do not prove a row matches the live site; that needs spot-checks against DIBBS.
- A blank buy type in the batch file is stored as an empty string (manual buy); `null` means no batch file was loaded for that line.

## What comes next

Live status for the shortlist; same-day postings; manufacturer names from a CAGE registry; reading the RFQ PDFs; alerts.
