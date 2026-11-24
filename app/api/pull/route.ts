import { pullLatest } from "@/lib/pull";

export const maxDuration = 300; // downloading and loading a few days can take a minute

export async function POST() {
  try {
    return Response.json(await pullLatest());
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "";
    // Messages from our own download and ingest checks are safe to show; hide anything else.
    const safe = /DIBBS|consent|web page|zip|Nothing loaded|index line|redirect/i.test(msg);
    return Response.json(
      { error: safe ? msg : "Could not pull data. DIBBS may be unreachable from this server, or the database is down." },
      { status: 502 }
    );
  }
}
