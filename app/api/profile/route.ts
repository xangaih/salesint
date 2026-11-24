import { cleanProfile, getProfile, saveProfile } from "@/lib/queries";

export async function GET() {
  try {
    return Response.json(await getProfile());
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Could not load the profile." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const r = cleanProfile(body);
  if ("errors" in r) return Response.json({ error: r.errors.join(" ") }, { status: 400 });
  try {
    return Response.json(await saveProfile(r.profile));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Could not save the profile." }, { status: 500 });
  }
}
