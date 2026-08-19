import { getRunSnapshot } from "@/lib/analysis/pipeline";
import { requireApiUser } from "@/lib/authz";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const { runId } = await context.params;
    return Response.json({
      run: await getRunSnapshot(runId, auth.user.email),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return Response.json(
      { error: message },
      { status: message === "run_not_found" ? 404 : 500 },
    );
  }
}
