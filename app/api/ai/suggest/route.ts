import { AiError, suggestFscs } from "@/lib/ai";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { description?: unknown };
    const description = typeof body.description === "string" ? body.description : "";
    return Response.json({ suggestions: await suggestFscs(description) });
  } catch (e) {
    if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
    console.error(e);
    return Response.json({ error: "Could not get suggestions." }, { status: 500 });
  }
}
