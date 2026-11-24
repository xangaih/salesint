import { getSummary } from "@/lib/queries";

export async function GET() {
  try {
    return Response.json(await getSummary());
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Could not load the summary. Is the database reachable?" }, { status: 500 });
  }
}
