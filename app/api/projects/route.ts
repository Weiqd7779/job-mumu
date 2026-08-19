import { listRecentProjects } from "@/lib/analysis/pipeline";
import { requireApiUser } from "@/lib/authz";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    return Response.json({
      projects: await listRecentProjects(auth.user.email),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return Response.json({ error: message }, { status: 500 });
  }
}
