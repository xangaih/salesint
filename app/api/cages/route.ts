import type { NextRequest } from "next/server";
import { suggestCages } from "@/lib/queries";

export async function GET(request: NextRequest) {
  try {
    const fscs = (request.nextUrl.searchParams.get("fscs") ?? "")
      .split(",").map((s) => s.trim()).filter((s) => /^\d{4}$/.test(s)).slice(0, 200);
    return Response.json(await suggestCages(fscs));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Could not load manufacturer suggestions." }, { status: 500 });
  }
}
