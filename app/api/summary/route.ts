import type { NextRequest } from "next/server";
import { getSummary } from "@/lib/queries";

export async function GET(request: NextRequest) {
  try {
    const qty = (k: string) => {
      const v = parseInt(request.nextUrl.searchParams.get(k) ?? "", 10);
      return Number.isFinite(v) && v >= 0 && v <= 2147483647 ? v : undefined;
    };
    return Response.json(await getSummary(qty("qmin"), qty("qmax")));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Could not load the summary. Is the database reachable?" }, { status: 500 });
  }
}
