import postgres from "postgres";

// Server-only. One shared connection pool (survives dev hot reloads).
const g = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

export function connect(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set (put it in .env.local)");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, {
    max: 5,
    prepare: false, // works with Supabase's transaction pooler too
    ssl: local ? false : "require",
    onnotice: () => {},
  });
}

export function db() {
  return (g.__sql ??= connect());
}

/** Today's date (YYYY-MM-DD) in America/New_York. */
export function todayNY(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
