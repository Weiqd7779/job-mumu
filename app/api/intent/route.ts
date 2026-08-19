import { previewIntent } from "@/lib/analysis/pipeline";
import { requireApiUser } from "@/lib/authz";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as { input?: string };
    const input = body.input?.trim() ?? "";
    if (input.length < 2) {
      return Response.json({ error: "input_too_short" }, { status: 400 });
    }
    if (input.length > 80_000) {
      return Response.json({ error: "input_too_large" }, { status: 413 });
    }
    return Response.json({ intent: await previewIntent(input) });
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
}
