import { createProjectRun } from "@/lib/analysis/pipeline";
import { requireApiUser } from "@/lib/authz";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      input?: string;
      forceNewProject?: boolean;
    };
    const input = body.input?.trim() ?? "";
    if (input.length < 2) {
      return Response.json({ error: "input_too_short" }, { status: 400 });
    }
    const run = await createProjectRun({
      userEmail: auth.user.email,
      displayName: auth.user.displayName,
      rawInput: input,
      forceNewProject: body.forceNewProject,
    });
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status =
      message === "monthly_paid_api_cap_reached"
        ? 402
        : message === "paid_analysis_paused"
          ? 503
          : 500;
    return Response.json({ error: message }, { status });
  }
}
