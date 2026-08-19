import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  factCards,
  projects,
  reportVersions,
  resumeVersions,
} from "@/db/schema";
import { createResumeDraft } from "@/lib/ai/resume";
import {
  assertMonthlyBudget,
  recordCost,
  type ReportPayload,
} from "@/lib/analysis/pipeline";
import { requireApiUser } from "@/lib/authz";
import { makeId } from "@/lib/ids";
import { emitRunTelemetry } from "@/lib/telemetry";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const projectId = text(body.projectId, 100);
    const sourceText = text(body.sourceText, 80_000);
    const language = body.language === "en" ? "en" : "zh-TW";
    const confirmed = body.confirmed === true;
    if (!projectId || sourceText.length < 20 || !confirmed) {
      return Response.json({ error: "verified_resume_source_required" }, { status: 400 });
    }

    const db = getDb();
    const project = (
      await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userEmail, auth.user.email)))
        .limit(1)
    )[0];
    if (!project) {
      return Response.json({ error: "project_not_found" }, { status: 404 });
    }
    const reportRow = (
      await db
        .select()
        .from(reportVersions)
        .where(eq(reportVersions.projectId, projectId))
        .orderBy(desc(reportVersions.versionNumber))
        .limit(1)
    )[0];
    if (!reportRow) {
      return Response.json({ error: "analysis_required" }, { status: 409 });
    }
    const report = JSON.parse(reportRow.reportJson) as ReportPayload;
    await assertMonthlyBudget();
    const draft = await createResumeDraft({
      targetRole: project.targetRole,
      sourceText,
      targetSkills: report.skillStats.slice(0, 15).map((skill) => skill.name),
      language,
    });
    const current = (
      await db
        .select({ maxVersion: sql<number>`coalesce(max(${resumeVersions.versionNumber}), 0)` })
        .from(resumeVersions)
        .where(eq(resumeVersions.projectId, projectId))
    )[0]?.maxVersion ?? 0;

    const factId = makeId("fact");
    const resumeId = makeId("resume");
    const costUsdMicros = Math.round(
      draft.usage.inputTokens * 0.5 + draft.usage.outputTokens * 2,
    );
    await recordCost({
      userEmail: auth.user.email,
      provider: "fireworks",
      operation: "resume_generation",
      modelId: draft.modelId,
      inputTokens: draft.usage.inputTokens,
      outputTokens: draft.usage.outputTokens,
      costUsdMicros,
    });
    await db.insert(factCards).values({
      id: factId,
      userEmail: auth.user.email,
      projectId,
      category: "user_confirmed_source",
      claim: sourceText,
      evidenceJson: JSON.stringify([{ type: "user_confirmation", at: new Date().toISOString() }]),
      verificationStatus: "user_confirmed",
      allowedInResume: true,
    });
    await db.insert(resumeVersions).values({
      id: resumeId,
      userEmail: auth.user.email,
      projectId,
      reportVersionId: reportRow.id,
      language,
      resumeJson: JSON.stringify({ ...draft, factCardIds: [factId] }),
      versionNumber: Number(current) + 1,
    });
    await emitRunTelemetry({
      executionId: resumeId,
      userEmail: auth.user.email,
      projectId,
      taskType: "resume",
      status: "complete",
      stage: "resume",
      modelId: draft.modelId,
      inputTokens: draft.usage.inputTokens,
      outputTokens: draft.usage.outputTokens,
      costUsdMicros,
    });
    return Response.json({
      resume: draft,
      resumeId,
      versionNumber: Number(current) + 1,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "resume_generation_failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    const db = getDb();
    const savedResumes = await db
      .select({ id: resumeVersions.id })
      .from(resumeVersions)
      .where(eq(resumeVersions.userEmail, auth.user.email));
    const savedFacts = await db
      .select({ id: factCards.id })
      .from(factCards)
      .where(eq(factCards.userEmail, auth.user.email));

    await db
      .delete(resumeVersions)
      .where(eq(resumeVersions.userEmail, auth.user.email));
    await db
      .delete(factCards)
      .where(eq(factCards.userEmail, auth.user.email));

    return Response.json({
      deletedResumeVersions: savedResumes.length,
      deletedFactCards: savedFacts.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "resume_data_deletion_failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
