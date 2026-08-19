import { toggleCluster } from "@/lib/analysis/pipeline";
import { requireApiUser } from "@/lib/authz";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ runId: string; clusterId: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const { runId, clusterId } = await context.params;
    const body = (await request.json()) as { included?: boolean };
    if (typeof body.included !== "boolean") {
      return Response.json({ error: "included_required" }, { status: 400 });
    }
    return Response.json({
      run: await toggleCluster({
        runId,
        clusterId,
        included: body.included,
        userEmail: auth.user.email,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return Response.json({ error: message }, { status: 500 });
  }
}
