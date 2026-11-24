import type { NextRequest } from "next/server";
import { listGroups } from "@/lib/queries";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const int = (k: string) => {
      const v = parseInt(sp.get(k) ?? "", 10);
      return Number.isFinite(v) ? v : undefined;
    };
    const tier = int("tier");
    const due = int("due");
    const qty = (k: string) => { const v = int(k); return v != null && v >= 0 && v <= 2147483647 ? v : undefined; };
    return Response.json(
      await listGroups({
        view: sp.get("view") === "all" ? "all" : "matches",
        tier: tier && tier >= 1 && tier <= 4 ? tier : undefined,
        due: due != null && due >= 0 && due <= 365 ? due : undefined,
        q: (sp.get("q") ?? "").slice(0, 100),
        qmin: qty("qmin"),
        qmax: qty("qmax"),
        page: int("page") ?? 1,
      })
    );
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Could not load RFQs. Is the database reachable?" }, { status: 500 });
  }
}
