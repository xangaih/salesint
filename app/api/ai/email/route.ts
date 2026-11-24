import { AiError, draftSupplierEmail } from "@/lib/ai";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { solicitation?: unknown; nsn?: unknown };
    const solicitation = typeof body.solicitation === "string" ? body.solicitation : "";
    const nsn = typeof body.nsn === "string" ? body.nsn : "";
    if (!/^[A-Z0-9]{13}$/.test(solicitation) || !nsn || nsn.length > 46) {
      return Response.json({ error: "Unknown RFQ." }, { status: 400 });
    }
    return Response.json(await draftSupplierEmail(solicitation, nsn));
  } catch (e) {
    if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
    console.error(e);
    return Response.json({ error: "Could not draft the email." }, { status: 500 });
  }
}
