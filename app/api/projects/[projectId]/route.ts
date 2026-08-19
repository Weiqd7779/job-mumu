import { getLatestProjectRun } from "@/lib/analysis/pipeline";
import { requireApiUser } from "@/lib/authz";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const { projectId } = await context.params;
    const run = await getLatestProjectRun(projectId, auth.user.email);
    return Response.json({ run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "project_open_failed";
    return Response.json(
      { error: message },
      { status: message.endsWith("_not_found") ? 404 : 500 },
    );
  }
}
