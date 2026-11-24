# DIBBS RFQ Finder

Work in progress. Step 1 of the build plan is done: schema, parser, ingest, and a table of all open RFQs.

## Run

1. Put `DATABASE_URL=<Supabase Postgres connection string>` in `.env.local` (never commit it).
2. Put the DIBBS daily files in `./data/` (`inYYMMDD.txt`, and `bqYYMMDD.zip` or the unzipped `bq*.txt` / `as*.txt`).
3. `npm install`
4. `npm run schema` (creates the tables; safe to re-run)
5. `npm run ingest` (loads every `in*.txt` in `./data/`, oldest first; safe to re-run)
6. `npm run dev` and open http://localhost:3000

`npm test` runs the parser tests.
