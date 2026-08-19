import { getDb } from "@/db";
import { problemReports } from "@/db/schema";
import { requireApiUser } from "@/lib/authz";
import { makeId, sha256Text } from "@/lib/ids";
import { readRuntimeEnv } from "@/lib/runtime-env";

const categories = new Set([
  "statistics",
  "clustering",
  "citation",
  "recommendation",
  "resume",
  "other",
]);

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const projectId = clean(body.projectId, 100);
    const runId = clean(body.runId, 100);
    const category = clean(body.category, 40);
    const message = clean(body.message, 2_000);
    const includeDebugContent = body.includeDebugContent === true;
    if (!projectId || !categories.has(category)) {
      return Response.json({ error: "invalid_problem_report" }, { status: 400 });
    }

    await getDb().insert(problemReports).values({
      id: makeId("problem"),
      userEmail: auth.user.email,
      projectId,
      runId: runId || null,
      category,
      message,
      includeDebugContent,
      debugExpiresAt: includeDebugContent
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString()
        : null,
    });

    await mirrorProblem({
      userEmail: auth.user.email,
      runId,
      category,
      message,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch {
    return Response.json({ error: "problem_report_failed" }, { status: 500 });
  }
}

async function mirrorProblem(input: {
  userEmail: string;
  runId: string;
  category: string;
  message: string;
}) {
  const endpoint = readRuntimeEnv("TELEMETRY_ENDPOINT");
  const token = readRuntimeEnv("TELEMETRY_WRITE_TOKEN");
  if (!endpoint || !token) return;
  try {
    const userHash = await sha256Text(
      `${input.userEmail.toLowerCase()}:${token.slice(0, 16)}`,
    );
    await fetch(endpoint.replace(/\/telemetry\/?$/, "/problems"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        executionId: input.runId,
        userHash,
        category: input.category,
        message: input.message,
        skillVersion: "1.0.0",
      }),
      signal: AbortSignal.timeout(3_500),
    });
  } catch {
    // The primary report is already stored in the user site.
  }
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
