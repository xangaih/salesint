import type { NextRequest } from "next/server";
import { listOpenGroups } from "@/lib/queries";

export async function GET(request: NextRequest) {
  try {
    const page = parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1;
    return Response.json(await listOpenGroups(page));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Could not load RFQs. Is the database reachable?" }, { status: 500 });
  }
}
