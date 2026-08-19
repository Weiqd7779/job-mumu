import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  analysisRuns,
  communityEvidence,
  costLedger,
  jobClusters,
  jobPostings,
  projectJobs,
  projects,
  reportVersions,
  runStages,
  salaryCompanies,
  skillMentions,
  users,
} from "@/db/schema";
import {
  createCareerSummary,
  type AgentResponseTrace,
  type AgentSummary,
} from "../ai/fireworks";
import {
  applyCompanyJobCap,
  COMPANY_JOB_CAP,
  findCompanyUniverseEntry,
  summarizeCompanyUniverse,
} from "../data/company-universe";
import { braveForumSearch, buildForumQueries } from "../data/brave";
import type { NormalizedJob } from "../data/jobs";
import { collectMarketJobs } from "../data/market-jobs";
import { fetchPublicJd } from "../data/public-jd";
import {
  exactCompanySalaryMatches,
  fetchOfficialSalaryData,
  type SalaryRecord,
} from "../data/salary";
import { userJdToJob } from "../data/taiwan-jobs";
import { makeId, sha256Text } from "../ids";
import { classifyInput } from "../input-intent";
import {
  CAREER_ANALYSIS_SKILL_NAME,
  CAREER_ANALYSIS_SKILL_VERSION,
} from "../skills/career-analysis";
import { emitRunTelemetry, readRuntimeControls } from "../telemetry";
import { clusterJobs } from "./clusters";
import {
  buildAgentCommunityContext,
  dedupeCommunityEvidence,
  isFirsthandCommunityResult,
  normalizeCommunityUrl,
  summarizeCommunityEvidence,
  type CommunityEvidenceSummary,
} from "./community";
import { calculateSkillStats, type SkillStat } from "./keyword-stats";
import { roleSelectionScore } from "./role-matcher";

export const PIPELINE_STAGES = [
  "intent",
  "collection",
  "clustering",
  "statistics",
  "salary",
  "community",
  "analysis",
  "report",
] as const;

type Stage = (typeof PIPELINE_STAGES)[number];

export type RunSnapshot = {
  id: string;
  projectId: string;
  projectTitle: string;
  targetRole: string;
  status: string;
  stage: string;
  progress: number;
  sampleCount: number;
  sourceSummary: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  report: ReportPayload | null;
};

export type ReportPayload = {
  reportVersion: number;
  targetRole: string;
  generatedAt: string;
  sampleCount: number;
  scannedCount: number;
  dateRange: string;
  agent: AgentSummary;
  agentTrace:
    | AgentResponseTrace
    | {
        status: "fallback";
        skillName: string;
        skillVersion: string;
        error: string;
      };
  skillStats: SkillStat[];
  clusters: Array<{
    id: string;
    name: string;
    reason: string;
    jobCount: number;
    included: boolean;
    representativeTitles: string[];
  }>;
  community: Array<{
    id: string;
    source: string;
    title: string;
    url: string;
    snippet: string;
    publishedAt: string | null;
    firsthand: boolean;
  }>;
  communitySummary: CommunityEvidenceSummary;
  salary: {
    matchedCompanies: Array<{
      companyName: string;
      market: string;
      year: number;
      medianAnnualSalary: number | null;
    }>;
    note: string;
  };
  sources: Record<string, { count: number; status: string; note?: string }>;
  limitations: string[];
};

export async function previewIntent(input: string) {
  const intent = classifyInput(input);
  return {
    ...intent,
    proposedSources:
      intent.type === "market"
        ? [
            "公司官方 ATS／Careers",
            "台灣就業通",
            "上市櫃薪資",
            "公開論壇",
          ]
        : ["使用者指定 JD", "上市櫃薪資", "公開論壇"],
    paidOperations: ["Fireworks 分析", "Brave 公開論壇搜尋"],
  };
}

export async function createProjectRun(input: {
  userEmail: string;
  displayName: string;
  rawInput: string;
  forceNewProject?: boolean;
}): Promise<RunSnapshot> {
  await assertMonthlyBudget();
  const db = getDb();
  const intent = classifyInput(input.rawInput);
  const timestamp = new Date().toISOString();
  const existing = input.forceNewProject
    ? null
    : (
        await db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.userEmail, input.userEmail),
              eq(projects.targetRole, intent.targetRole),
            ),
          )
          .orderBy(desc(projects.updatedAt))
          .limit(1)
      )[0];
  const projectId = existing?.id ?? makeId("prj");
  const runId = makeId("run");

  await db
    .insert(users)
    .values({
      email: input.userEmail,
      displayName: input.displayName,
      lastSeenAt: timestamp,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { displayName: input.displayName, lastSeenAt: timestamp },
    });

  if (existing) {
    await db
      .update(projects)
      .set({
        inputType: intent.type,
        inputValue: input.rawInput,
        status: "analyzing",
        updatedAt: timestamp,
      })
      .where(eq(projects.id, projectId));
  } else {
    await db.insert(projects).values({
      id: projectId,
      userEmail: input.userEmail,
      title: intent.targetRole,
      targetRole: intent.targetRole,
      inputType: intent.type,
      inputValue: input.rawInput,
      configJson: JSON.stringify({ resumeRequested: intent.resumeRequested }),
      status: "analyzing",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await db.insert(analysisRuns).values({
    id: runId,
    projectId,
    userEmail: input.userEmail,
    status: "running",
    currentStage: "intent",
    progress: 0,
    inputType: intent.type,
    inputText: input.rawInput,
    normalizedIntentJson: JSON.stringify(intent),
    skillVersion: CAREER_ANALYSIS_SKILL_VERSION,
    startedAt: timestamp,
  });
  await upsertStage(runId, "intent", "pending");
  return getRunSnapshot(runId, input.userEmail);
}

export async function advanceRun(
  runId: string,
  userEmail: string,
): Promise<RunSnapshot> {
  const startedAt = Date.now();
  const db = getDb();
  const run = await ownedRun(runId, userEmail);
  if (run.status === "complete") {
    return getRunSnapshot(runId, userEmail);
  }
  if (run.status === "failed") {
    await db
      .update(analysisRuns)
      .set({
        status: "running",
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
      })
      .where(eq(analysisRuns.id, runId));
  }
  const stage = run.currentStage as Stage;

  await upsertStage(runId, stage, "running");
  try {
    if (stage === "intent") await stageIntent(run);
    if (stage === "collection") await stageCollection(run);
    if (stage === "clustering") await stageClustering(run);
    if (stage === "statistics") await stageStatistics(run);
    if (stage === "salary") await stageSalary(run);
    if (stage === "community") await stageCommunity(run);
    if (stage === "analysis") await stageAnalysis(run);
    if (stage === "report") await stageReport(run);
    await upsertStage(runId, stage, "complete");

    const currentIndex = PIPELINE_STAGES.indexOf(stage);
    const next = PIPELINE_STAGES[currentIndex + 1];
    if (next) {
      await db
        .update(analysisRuns)
        .set({
          currentStage: next,
          progress: Math.round(((currentIndex + 1) / PIPELINE_STAGES.length) * 100),
        })
        .where(eq(analysisRuns.id, runId));
      await upsertStage(runId, next, "pending");
    } else {
      const finishedAt = new Date().toISOString();
      await db
        .update(analysisRuns)
        .set({
          status: "complete",
          progress: 100,
          finishedAt,
          errorCode: null,
          errorMessage: null,
        })
        .where(eq(analysisRuns.id, runId));
      await db
        .update(projects)
        .set({ status: "complete", updatedAt: finishedAt })
        .where(eq(projects.id, run.projectId));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const recoverable = isRecoverableStage(stage, message);
    await upsertStage(runId, stage, recoverable ? "partial" : "failed", {
      error: safeError(message),
    });
    if (recoverable) {
      const currentIndex = PIPELINE_STAGES.indexOf(stage);
      const next = PIPELINE_STAGES[currentIndex + 1];
      await mergeSourceSummary(runId, {
        [`${stage}_error`]: safeError(message),
      });
      await db
        .update(analysisRuns)
        .set({
          currentStage: next ?? "report",
          progress: Math.round(((currentIndex + 1) / PIPELINE_STAGES.length) * 100),
          errorCode: `${stage}_partial`,
          errorMessage: safeError(message),
        })
        .where(eq(analysisRuns.id, runId));
    } else {
      await db
        .update(analysisRuns)
        .set({
          status: "failed",
          errorCode: `${stage}_failed`,
          errorMessage: safeError(message),
          finishedAt: new Date().toISOString(),
        })
        .where(eq(analysisRuns.id, runId));
      await db
        .update(projects)
        .set({ status: "needs_attention", updatedAt: new Date().toISOString() })
        .where(eq(projects.id, run.projectId));
    }
  }
  const snapshot = await getRunSnapshot(runId, userEmail);
  const refreshedRun = await ownedRun(runId, userEmail);
  const sourceSummary = parseJson<Record<string, unknown>>(
    refreshedRun.sourceSummaryJson,
    {},
  );
  const brave = sourceSummary.brave as
    | { count?: number; queries?: number }
    | undefined;
  const usage = (
    await db
      .select({
        inputTokens: sql<number>`coalesce(sum(${costLedger.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${costLedger.outputTokens}), 0)`,
        costUsdMicros: sql<number>`coalesce(sum(${costLedger.costUsdMicros}), 0)`,
      })
      .from(costLedger)
      .where(eq(costLedger.runId, runId))
  )[0];
  await emitRunTelemetry({
    executionId: runId,
    userEmail,
    projectId: refreshedRun.projectId,
    taskType: refreshedRun.inputType,
    agentSkill: CAREER_ANALYSIS_SKILL_NAME,
    skillVersion: refreshedRun.skillVersion,
    status: refreshedRun.status,
    stage,
    modelId: refreshedRun.modelId,
    latencyMs: Date.now() - startedAt,
    inputTokens: Number(usage?.inputTokens ?? 0),
    outputTokens: Number(usage?.outputTokens ?? 0),
    costUsdMicros: Number(usage?.costUsdMicros ?? 0),
    fallbackUsed: Boolean(sourceSummary.agent_fallback),
    braveQueries: brave?.queries ?? 0,
    braveResults: brave?.count ?? 0,
    sourceStatus: sourceSummary,
    qualityFlags: refreshedRun.errorCode ? [refreshedRun.errorCode] : [],
  });
  return snapshot;
}

export async function getRunSnapshot(
  runId: string,
  userEmail: string,
): Promise<RunSnapshot> {
  const db = getDb();
  const run = await ownedRun(runId, userEmail);
  const project = (
    await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1)
  )[0];
  const reportRow = (
    await db
      .select()
      .from(reportVersions)
      .where(eq(reportVersions.runId, runId))
      .orderBy(desc(reportVersions.versionNumber))
      .limit(1)
  )[0];
  return {
    id: run.id,
    projectId: run.projectId,
    projectTitle: project?.title ?? "求職專案",
    targetRole: project?.targetRole ?? "未命名職務",
    status: run.status,
    stage: run.currentStage,
    progress: run.progress,
    sampleCount: run.sampleCount,
    sourceSummary: parseJson(run.sourceSummaryJson, {}),
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    report: reportRow ? parseJson<ReportPayload | null>(reportRow.reportJson, null) : null,
  };
}

export async function listRecentProjects(userEmail: string) {
  const db = getDb();
  return db
    .select({
      id: projects.id,
      title: projects.title,
      targetRole: projects.targetRole,
      status: projects.status,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.userEmail, userEmail))
    .orderBy(desc(projects.updatedAt))
    .limit(8);
}

export async function getLatestProjectRun(
  projectId: string,
  userEmail: string,
): Promise<RunSnapshot> {
  const db = getDb();
  const ownedProject = (
    await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userEmail, userEmail)))
      .limit(1)
  )[0];
  if (!ownedProject) throw new Error("project_not_found");
  const run = (
    await db
      .select({ id: analysisRuns.id })
      .from(analysisRuns)
      .where(
        and(
          eq(analysisRuns.projectId, projectId),
          eq(analysisRuns.userEmail, userEmail),
        ),
      )
      .orderBy(desc(analysisRuns.createdAt))
      .limit(1)
  )[0];
  if (!run) throw new Error("run_not_found");
  return getRunSnapshot(run.id, userEmail);
}

export async function toggleCluster(input: {
  runId: string;
  clusterId: string;
  included: boolean;
  userEmail: string;
}): Promise<RunSnapshot> {
  const db = getDb();
  const run = await ownedRun(input.runId, input.userEmail);
  await db
    .update(jobClusters)
    .set({ included: input.included })
    .where(and(eq(jobClusters.id, input.clusterId), eq(jobClusters.runId, run.id)));
  await db
    .update(projectJobs)
    .set({ included: input.included })
    .where(
      and(
        eq(projectJobs.runId, run.id),
        eq(projectJobs.clusterId, input.clusterId),
      ),
    );
  await db.delete(skillMentions).where(eq(skillMentions.runId, run.id));
  await db
    .update(analysisRuns)
    .set({
      status: "running",
      currentStage: "statistics",
      progress: 38,
      resultJson: null,
      errorCode: null,
      errorMessage: null,
    })
    .where(eq(analysisRuns.id, run.id));
  await upsertStage(run.id, "statistics", "pending");
  return getRunSnapshot(run.id, input.userEmail);
}

async function stageIntent(run: typeof analysisRuns.$inferSelect) {
  const intent = classifyInput(run.inputText);
  await getDb()
    .update(analysisRuns)
    .set({ normalizedIntentJson: JSON.stringify(intent) })
    .where(eq(analysisRuns.id, run.id));
}

async function stageCollection(run: typeof analysisRuns.$inferSelect) {
  const db = getDb();
  const intent = parseJson<ReturnType<typeof classifyInput>>(
    run.normalizedIntentJson,
    classifyInput(run.inputText),
  );
  let jobs: NormalizedJob[] = [];
  let collectedJobs: NormalizedJob[] = [];
  let scanned = 1;
  let updateTime: string | null = null;
  let marketSourceSummary: Awaited<
    ReturnType<typeof collectMarketJobs>
  >["sourceSummary"] | null = null;
  let companyCapSummary: ReturnType<
    typeof applyCompanyJobCap<NormalizedJob>
  > | null = null;

  if (intent.type === "market") {
    const result = await collectMarketJobs(intent.targetRole);
    collectedJobs = result.jobs;
    companyCapSummary = applyCompanyJobCap(
      collectedJobs,
      COMPANY_JOB_CAP,
      (job) => roleSelectionScore(intent.targetRole, job),
    );
    jobs = companyCapSummary.jobs;
    scanned = result.scanned;
    updateTime = result.updateTime;
    marketSourceSummary = result.sourceSummary;
  } else if (intent.type === "single_jd_url") {
    const match = run.inputText.match(/https?:\/\/[^\s<>"']+/i);
    if (!match) throw new Error("jd_url_missing");
    jobs = [await fetchPublicJd(match[0])];
    collectedJobs = jobs;
  } else {
    jobs = [userJdToJob(run.inputText, intent.targetRole)];
    collectedJobs = jobs;
  }

  if (!jobs.length) throw new Error("no_matching_jobs");
  const universeSummary = summarizeCompanyUniverse();
  const matchedUniverseCompanies = new Set(
    collectedJobs
      .map((job) => findCompanyUniverseEntry(job.company)?.id)
      .filter((companyId): companyId is string => Boolean(companyId)),
  );
  const selectedJobs = new Set(jobs);
  for (const job of collectedJobs) {
    const hash = await sha256Text(
      `${job.source}|${job.title}|${job.company}|${job.description}`,
    );
    const jobId = `job_${hash.slice(0, 28)}`;
    await db
      .insert(jobPostings)
      .values({
        id: jobId,
        source: job.source,
        sourceJobId: job.sourceJobId,
        canonicalUrl: job.canonicalUrl,
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.mayStoreOriginal
          ? job.description
          : job.description.slice(0, 12_000),
        requiredText: job.requiredText,
        preferredText: job.preferredText,
        salaryText: job.salaryText,
        publishedAt: job.publishedAt,
        contentHash: hash,
        licenseType: job.licenseType,
        mayStoreOriginal: job.mayStoreOriginal,
      })
      .onConflictDoNothing();
    if (selectedJobs.has(job)) {
      await db
        .insert(projectJobs)
        .values({
          projectId: run.projectId,
          runId: run.id,
          jobId,
          included: true,
        })
        .onConflictDoNothing();
    }
  }
  await db
    .update(analysisRuns)
    .set({
      sampleCount: jobs.length,
      sourceSummaryJson: JSON.stringify({
        taiwan_jobs: {
          count:
            intent.type === "market"
              ? marketSourceSummary?.taiwan_jobs.matchedUniverse ?? 0
              : 0,
          status:
            intent.type === "market"
              ? marketSourceSummary?.taiwan_jobs.status ?? "error"
              : "not_used",
          scanned:
            intent.type === "market"
              ? marketSourceSummary?.taiwan_jobs.scanned ?? 0
              : 0,
          updateTime:
            marketSourceSummary?.taiwan_jobs.updateTime ?? updateTime,
          matchedBeforeCompanyCap:
            companyCapSummary?.beforeCount ?? collectedJobs.length,
          removedByCompanyCap: companyCapSummary?.removedCount ?? 0,
          companyCap: COMPANY_JOB_CAP,
          companiesAfterCap:
            companyCapSummary?.companyCount ??
            new Set(jobs.map((job) => job.company)).size,
        },
        ats: {
          count:
            intent.type === "market"
              ? marketSourceSummary?.ats.matchedRole ?? 0
              : 0,
          status:
            intent.type === "market"
              ? marketSourceSummary?.ats.status ?? "error"
              : "not_used",
          ...(marketSourceSummary?.ats ?? {}),
        },
        collection: {
          count: collectedJobs.length,
          status: "complete",
          scanned,
          selectedForAnalysis: jobs.length,
          storedBeforeCompanyCap: collectedJobs.length,
        },
        company_universe: {
          count: universeSummary.companies,
          status:
            intent.type === "market"
              ? marketSourceSummary?.ats.failedSources ||
                marketSourceSummary?.company_universe.fallbackOnlyCompanies
                ? "partial"
                : "complete"
              : "not_used",
          version: universeSummary.version,
          listedCompanies: universeSummary.listedCompanies,
          additionalCompanies: universeSummary.additionalCompanies,
          matchedCompanies: matchedUniverseCompanies.size,
          directConfiguredCompanies:
            marketSourceSummary?.company_universe.directConfiguredCompanies ??
            0,
          fallbackOnlyCompanies:
            marketSourceSummary?.company_universe.fallbackOnlyCompanies ?? 0,
          zeroMatchedCompanies:
            marketSourceSummary?.company_universe.zeroMatchedCompanies ?? 0,
          note:
            intent.type === "market"
              ? "30 家固定母體已載入；已設定的 ATS 直接列舉，其餘公司以台灣就業通作補充，零命中與來源失敗分開記錄。"
              : undefined,
        },
        user_jd: {
          count: intent.type === "market" ? 0 : jobs.length,
          status: intent.type === "market" ? "not_used" : "complete",
        },
      }),
    })
    .where(eq(analysisRuns.id, run.id));
}

async function stageClustering(run: typeof analysisRuns.$inferSelect) {
  const db = getDb();
  const rows = await loadRunJobs(run.id, true);
  const normalized = rows.map(jobRowToNormalized);
  const targetRole = parseJson<ReturnType<typeof classifyInput>>(
    run.normalizedIntentJson,
    classifyInput(run.inputText),
  ).targetRole;
  const clusters = clusterJobs(normalized, targetRole);
  await db.delete(jobClusters).where(eq(jobClusters.runId, run.id));

  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index];
    const clusterId = makeId("clu");
    await db.insert(jobClusters).values({
      id: clusterId,
      runId: run.id,
      name: cluster.name,
      reason: cluster.reason,
      representativeTitlesJson: JSON.stringify(cluster.representativeTitles),
      jobCount: cluster.jobIndexes.length,
      included: cluster.included,
      sortOrder: index,
    });
    const jobIds = cluster.jobIndexes.map((jobIndex) => rows[jobIndex].id);
    for (const jobIdBatch of chunks(jobIds, 50)) {
      await db
        .update(projectJobs)
        .set({ clusterId, included: cluster.included })
        .where(
          and(
            eq(projectJobs.runId, run.id),
            inArray(projectJobs.jobId, jobIdBatch),
          ),
        );
    }
  }
}

async function stageStatistics(run: typeof analysisRuns.$inferSelect) {
  const db = getDb();
  const rows = await loadRunJobs(run.id, false);
  const jobs = rows.map(jobRowToNormalized);
  if (!jobs.length) throw new Error("all_clusters_excluded");
  const stats = calculateSkillStats(jobs);
  await db.delete(skillMentions).where(eq(skillMentions.runId, run.id));

  for (const stat of stats) {
    for (const evidence of stat.evidence) {
      const job = rows[evidence.jobIndex];
      if (!job) continue;
      await db.insert(skillMentions).values({
        id: makeId("skm"),
        runId: run.id,
        jobId: job.id,
        normalizedSkill: stat.name,
        rawKeyword: evidence.keyword,
        requirementType: evidence.requirementType,
        evidenceText: evidence.text,
      });
    }
  }
  await db
    .update(analysisRuns)
    .set({ sampleCount: jobs.length, resultJson: JSON.stringify({ skillStats: stats }) })
    .where(eq(analysisRuns.id, run.id));
}

async function stageSalary(run: typeof analysisRuns.$inferSelect) {
  const db = getDb();
  const rows = await loadRunJobs(run.id, false);
  const records = await fetchOfficialSalaryData();
  const matches = exactCompanySalaryMatches(
    rows.map((row) => row.company).filter(Boolean),
    records,
  );
  for (const record of matches) {
    await db
      .insert(salaryCompanies)
      .values({
        companyCode: record.companyCode,
        year: record.year,
        market: record.market,
        companyName: record.companyName,
        industry: record.industry,
        medianAnnualSalary: record.medianAnnualSalary,
        averageAnnualSalary: record.averageAnnualSalary,
        sourceUrl: record.sourceUrl,
      })
      .onConflictDoUpdate({
        target: [
          salaryCompanies.companyCode,
          salaryCompanies.year,
          salaryCompanies.market,
        ],
        set: {
          companyName: record.companyName,
          industry: record.industry,
          medianAnnualSalary: record.medianAnnualSalary,
          averageAnnualSalary: record.averageAnnualSalary,
          fetchedAt: new Date().toISOString(),
        },
      });
  }
  await mergeResult(run.id, {
    salaryMatches: matches.map(safeSalary),
    salaryDatasetCount: records.length,
  });
}

async function stageCommunity(run: typeof analysisRuns.$inferSelect) {
  const db = getDb();
  const intent = parseJson<ReturnType<typeof classifyInput>>(
    run.normalizedIntentJson,
    classifyInput(run.inputText),
  );
  const queries = buildForumQueries(intent.targetRole).slice(
    0,
    intent.type === "market" ? 3 : 3,
  );
  const existingRows = await db
    .select({ url: communityEvidence.url })
    .from(communityEvidence)
    .where(eq(communityEvidence.runId, run.id));
  const seenUrls = new Set(
    existingRows
      .map((row) => normalizeCommunityUrl(row.url))
      .filter((url): url is string => Boolean(url)),
  );
  let stored = 0;
  for (const query of queries) {
    const results = await braveForumSearch(query, 8);
    for (const result of results) {
      if (!isApprovedForumUrl(result.url)) continue;
      const normalizedUrl = normalizeCommunityUrl(result.url);
      if (!normalizedUrl || seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);
      await db.insert(communityEvidence).values({
        id: makeId("com"),
        runId: run.id,
        query,
        source: result.source,
        title: result.title,
        url: normalizedUrl,
        snippet: result.snippet.slice(0, 1200),
        publishedAt: result.publishedAt,
        firsthand: isFirsthandCommunityResult(result.title, result.snippet),
      });
      stored += 1;
    }
    await recordCost({
      runId: run.id,
      userEmail: run.userEmail,
      provider: "brave",
      operation: "forum_search",
      queryCount: 1,
      costUsdMicros: 5_000,
    });
  }
  const allRows = await loadCommunityEvidence(run.id);
  const evidenceSummary = summarizeCommunityEvidence(allRows);
  await mergeSourceSummary(run.id, {
    brave: {
      count: evidenceSummary.count,
      queries: queries.length,
      stored,
      sourceCount: evidenceSummary.sourceCount,
      firsthandCount: evidenceSummary.firsthandCount,
      thresholdMet: evidenceSummary.thresholdMet,
      status: "complete",
    },
  });
}

async function stageAnalysis(run: typeof analysisRuns.$inferSelect) {
  const db = getDb();
  const result = parseJson<Record<string, unknown>>(run.resultJson, {});
  const stats = (result.skillStats ?? []) as SkillStat[];
  const community = buildAgentCommunityContext(
    await loadCommunityEvidence(run.id),
  );
  const sourceSummary = parseJson<Record<string, unknown>>(run.sourceSummaryJson, {});

  let agent: AgentSummary;
  let agentTrace: ReportPayload["agentTrace"];
  try {
    const invocation = await createCareerSummary({
      targetRole: parseJson<ReturnType<typeof classifyInput>>(
        run.normalizedIntentJson,
        classifyInput(run.inputText),
      ).targetRole,
      sampleCount: run.sampleCount,
      calculatedAt: new Date().toISOString(),
      skillStats: stats.slice(0, 8).map((stat) => ({
        id: skillEvidenceId(stat.name),
        name: stat.name,
        n: stat.n,
        N: stat.N,
        percent: stat.percent,
        companyN: stat.companyN,
        companyTotal: stat.companyTotal,
        companyPercent: stat.companyPercent,
        requiredN: stat.requiredN,
        preferredN: stat.preferredN,
      })),
      community,
      sourceLimitations: extractSourceLimitations(sourceSummary),
    });
    agent = invocation.agent;
    agentTrace = invocation.trace;
    const cost = Math.round(
      agent.usage.inputTokens * 0.5 + agent.usage.outputTokens * 2,
    );
    await recordCost({
      runId: run.id,
      userEmail: run.userEmail,
      provider: "fireworks",
      operation: "career_analysis",
      modelId: agent.modelId,
      inputTokens: agent.usage.inputTokens,
      outputTokens: agent.usage.outputTokens,
      costUsdMicros: cost,
    });
    await mergeSourceSummary(run.id, {
      agent_fallback: undefined,
      agent_skill: {
        count: 1,
        status: "validated",
        name: invocation.trace.skillName,
        version: invocation.trace.skillVersion,
        promptHash: invocation.trace.promptHash,
        modelId: invocation.trace.modelId,
        checks: invocation.trace.checks,
      },
    });
    await db
      .update(analysisRuns)
      .set({
        skillVersion: invocation.trace.skillVersion,
        promptHash: invocation.trace.promptHash,
      })
      .where(eq(analysisRuns.id, run.id));
  } catch (error) {
    agent = fallbackAgentSummary(stats, run.sampleCount, error);
    agentTrace = {
      status: "fallback",
      skillName: CAREER_ANALYSIS_SKILL_NAME,
      skillVersion: CAREER_ANALYSIS_SKILL_VERSION,
      error: safeError(
        error instanceof Error ? error.message : "agent_error",
      ),
    };
    await mergeSourceSummary(run.id, {
      agent_fallback: safeError(
        error instanceof Error ? error.message : "agent_error",
      ),
      agent_skill: {
        count: 0,
        status: "fallback",
        name: CAREER_ANALYSIS_SKILL_NAME,
        version: CAREER_ANALYSIS_SKILL_VERSION,
      },
    });
  }
  await mergeResult(run.id, { agent, agentTrace });
  await db
    .update(analysisRuns)
    .set({ modelId: agent.modelId })
    .where(eq(analysisRuns.id, run.id));
}

async function stageReport(run: typeof analysisRuns.$inferSelect) {
  const db = getDb();
  const project = (
    await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1)
  )[0];
  const result = parseJson<Record<string, unknown>>(run.resultJson, {});
  const stats = (result.skillStats ?? []) as SkillStat[];
  const agent =
    (result.agent as AgentSummary | undefined) ??
    fallbackAgentSummary(stats, run.sampleCount);
  const agentTrace =
    (result.agentTrace as ReportPayload["agentTrace"] | undefined) ?? {
      status: "fallback" as const,
      skillName: CAREER_ANALYSIS_SKILL_NAME,
      skillVersion: CAREER_ANALYSIS_SKILL_VERSION,
      error: "agent_trace_missing",
    };
  const clusterRows = await db
    .select()
    .from(jobClusters)
    .where(eq(jobClusters.runId, run.id))
    .orderBy(jobClusters.sortOrder);
  const communityRows = dedupeCommunityEvidence(
    await loadCommunityEvidence(run.id),
  ).slice(0, 40);
  const communitySummary = summarizeCommunityEvidence(communityRows);
  const latestReport = (
    await db
      .select({ versionNumber: reportVersions.versionNumber })
      .from(reportVersions)
      .where(eq(reportVersions.projectId, run.projectId))
      .orderBy(desc(reportVersions.versionNumber))
      .limit(1)
  )[0];
  const versionNumber = (latestReport?.versionNumber ?? 0) + 1;
  const sourceSummary = parseJson<Record<string, unknown>>(run.sourceSummaryJson, {});
  const limitations = [
    "所有百分比只代表本次保留樣本。",
    "公司官方 ATS 與台灣就業通共同蒐集；未設定直接 adapter 的公司可能低估。",
    "104、1111 與一般 LinkedIn 職缺未在無正式授權下自動擷取。",
    !communitySummary.thresholdMet
      ? "公開論壇未同時達到至少 3 篇、跨 2 個來源且至少 1 篇疑似第一手內容，社群訊號不形成結論。"
      : "",
    ...agent.limitations,
  ].filter(Boolean);
  const report: ReportPayload = {
    reportVersion: versionNumber,
    targetRole: project?.targetRole ?? "未命名職務",
    generatedAt: new Date().toISOString(),
    sampleCount: run.sampleCount,
    scannedCount:
      Number(
        (
          sourceSummary.collection as
            | { scanned?: number }
            | undefined
        )?.scanned ?? run.sampleCount,
      ) || run.sampleCount,
    dateRange: "本次取得之有效資料",
    agent,
    agentTrace,
    skillStats: stats,
    clusters: clusterRows.map((cluster) => ({
      id: cluster.id,
      name: cluster.name,
      reason: cluster.reason,
      jobCount: cluster.jobCount,
      included: cluster.included,
      representativeTitles: parseJson<string[]>(
        cluster.representativeTitlesJson,
        [],
      ),
    })),
    community: communityRows.map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      publishedAt: item.publishedAt,
      firsthand: item.firsthand,
    })),
    communitySummary,
    salary: {
      matchedCompanies: (
        (result.salaryMatches ?? []) as ReturnType<typeof safeSalary>[]
      ).map((item) => ({
        companyName: item.companyName,
        market: item.market,
        year: item.year,
        medianAnnualSalary: item.medianAnnualSalary,
      })),
      note:
        ((result.salaryMatches ?? []) as unknown[]).length > 0
          ? "僅列出精確法律實體比對成功的上市櫃公司。"
          : "本次沒有可精確比對的上市櫃公司薪資中位數。",
    },
    sources: normalizeSourceSummary(sourceSummary),
    limitations,
  };

  await db.insert(reportVersions).values({
    id: makeId("rpt"),
    projectId: run.projectId,
    runId: run.id,
    versionNumber,
    title: `${report.targetRole} 市場分析`,
    reportJson: JSON.stringify(report),
  });
}

async function ownedRun(runId: string, userEmail: string) {
  const run = (
    await getDb()
      .select()
      .from(analysisRuns)
      .where(
        and(eq(analysisRuns.id, runId), eq(analysisRuns.userEmail, userEmail)),
      )
      .limit(1)
  )[0];
  if (!run) throw new Error("run_not_found");
  return run;
}

async function upsertStage(
  runId: string,
  stage: string,
  status: string,
  detail: Record<string, unknown> = {},
) {
  const timestamp = new Date().toISOString();
  await getDb()
    .insert(runStages)
    .values({
      runId,
      stage,
      status,
      detailJson: JSON.stringify(detail),
      startedAt: status === "running" ? timestamp : null,
      finishedAt: ["complete", "partial", "failed"].includes(status)
        ? timestamp
        : null,
    })
    .onConflictDoUpdate({
      target: [runStages.runId, runStages.stage],
      set: {
        status,
        detailJson: JSON.stringify(detail),
        startedAt: status === "running" ? timestamp : undefined,
        finishedAt: ["complete", "partial", "failed"].includes(status)
          ? timestamp
          : undefined,
      },
    });
}

async function loadRunJobs(runId: string, includeExcluded: boolean) {
  const db = getDb();
  const condition = includeExcluded
    ? eq(projectJobs.runId, runId)
    : and(eq(projectJobs.runId, runId), eq(projectJobs.included, true));
  return db
    .select({
      id: jobPostings.id,
      source: jobPostings.source,
      sourceJobId: jobPostings.sourceJobId,
      canonicalUrl: jobPostings.canonicalUrl,
      title: jobPostings.title,
      company: jobPostings.company,
      location: jobPostings.location,
      description: jobPostings.description,
      requiredText: jobPostings.requiredText,
      preferredText: jobPostings.preferredText,
      salaryText: jobPostings.salaryText,
      publishedAt: jobPostings.publishedAt,
      licenseType: jobPostings.licenseType,
      mayStoreOriginal: jobPostings.mayStoreOriginal,
    })
    .from(projectJobs)
    .innerJoin(jobPostings, eq(projectJobs.jobId, jobPostings.id))
    .where(condition);
}

function jobRowToNormalized(
  row: Awaited<ReturnType<typeof loadRunJobs>>[number],
): NormalizedJob {
  return {
    source: row.source as NormalizedJob["source"],
    sourceJobId: row.sourceJobId,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    company: row.company,
    location: row.location,
    description: row.description,
    requiredText: row.requiredText,
    preferredText: row.preferredText,
    salaryText: row.salaryText,
    publishedAt: row.publishedAt,
    licenseType: row.licenseType,
    mayStoreOriginal: row.mayStoreOriginal,
  };
}

async function mergeResult(runId: string, patch: Record<string, unknown>) {
  const db = getDb();
  const run = (
    await db
      .select({ resultJson: analysisRuns.resultJson })
      .from(analysisRuns)
      .where(eq(analysisRuns.id, runId))
      .limit(1)
  )[0];
  const current = parseJson<Record<string, unknown>>(run?.resultJson, {});
  await db
    .update(analysisRuns)
    .set({ resultJson: JSON.stringify({ ...current, ...patch }) })
    .where(eq(analysisRuns.id, runId));
}

async function mergeSourceSummary(runId: string, patch: Record<string, unknown>) {
  const db = getDb();
  const run = (
    await db
      .select({ sourceSummaryJson: analysisRuns.sourceSummaryJson })
      .from(analysisRuns)
      .where(eq(analysisRuns.id, runId))
      .limit(1)
  )[0];
  const current = parseJson<Record<string, unknown>>(run?.sourceSummaryJson, {});
  await db
    .update(analysisRuns)
    .set({ sourceSummaryJson: JSON.stringify({ ...current, ...patch }) })
    .where(eq(analysisRuns.id, runId));
}

export async function recordCost(input: {
  runId?: string;
  userEmail?: string;
  provider: string;
  operation: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  queryCount?: number;
  costUsdMicros: number;
}) {
  const db = getDb();
  await db.insert(costLedger).values({
    id: makeId("cost"),
    runId: input.runId,
    userEmail: input.userEmail,
    provider: input.provider,
    operation: input.operation,
    modelId: input.modelId,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    queryCount: input.queryCount ?? 0,
    costUsdMicros: input.costUsdMicros,
  });
  if (input.runId) {
    await db
      .update(analysisRuns)
      .set({
        estimatedCostUsdMicros: sql`${analysisRuns.estimatedCostUsdMicros} + ${input.costUsdMicros}`,
      })
      .where(eq(analysisRuns.id, input.runId));
  }
}

export async function assertMonthlyBudget() {
  const controls = await readRuntimeControls();
  if (controls?.paidAnalysisPaused) {
    throw new Error("paid_analysis_paused");
  }
  const db = getDb();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const totals = await db
    .select({
      provider: costLedger.provider,
      total: sql<number>`coalesce(sum(${costLedger.costUsdMicros}), 0)`,
    })
    .from(costLedger)
    .where(sql`${costLedger.createdAt} >= ${monthStart.toISOString()}`)
    .groupBy(costLedger.provider);
  const total = totals.reduce((sum, row) => sum + Number(row.total), 0);
  const fireworks =
    Number(totals.find((row) => row.provider === "fireworks")?.total) || 0;
  const brave =
    Number(totals.find((row) => row.provider === "brave")?.total) || 0;
  const totalCap = controls?.monthlyTotalCapMicros ?? 25_000_000;
  const fireworksCap = controls?.fireworksCapMicros ?? 20_000_000;
  const braveCap = controls?.braveCapMicros ?? 5_000_000;
  if (total >= totalCap || fireworks >= fireworksCap || brave >= braveCap) {
    throw new Error("monthly_paid_api_cap_reached");
  }
}

function fallbackAgentSummary(
  stats: SkillStat[],
  sampleCount: number,
  error?: unknown,
): AgentSummary {
  const top = stats.slice(0, 5);
  return {
    summary: top.length
      ? `本次 ${sampleCount} 份保留樣本中，較常出現的能力為 ${top
          .slice(0, 3)
          .map((item) => `${item.name}（${item.n}/${item.N}）`)
          .join("、")}。此為程式化統計摘要，Agent 深度分析目前未完成。`
      : "本次樣本尚未形成可用的技能統計。",
    facts: top.map((item, index) => ({
      id: `fallback-fact-${index + 1}`,
      kind: "fact" as const,
      text: `${item.name} 出現在本次 ${item.n}/${item.N} 份 JD（${item.percent}%）。`,
      evidenceIds: [skillEvidenceId(item.name)],
      confidence: sampleCount >= 20 ? ("medium" as const) : ("low" as const),
    })),
    inferences: [],
    communitySignals: [],
    recommendations: top.map((item, index) => ({
      priority: index + 1,
      title: `準備 ${item.name}`,
      reason: `此能力出現在本次 ${item.n}/${item.N} 份 JD（${item.percent}%）。`,
      evidenceIds: [skillEvidenceId(item.name)],
    })),
    limitations: [
      "目前使用確定性統計備援摘要。",
      error instanceof Error ? `Agent 暫時不可用：${safeError(error.message)}` : "",
    ].filter(Boolean),
    citations: top.map((item) => ({
      id: skillEvidenceId(item.name),
      source: "本次程式化 JD 統計",
      url: "",
      publishedAt: null,
    })),
    confidence: sampleCount >= 20 ? "medium" : "low",
    skillVersion: CAREER_ANALYSIS_SKILL_VERSION,
    modelId: "deterministic-fallback",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function skillEvidenceId(name: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return `stat-${slug || "skill"}`;
}

function extractSourceLimitations(
  sourceSummary: Record<string, unknown>,
): string[] {
  const limitations = Object.keys(sourceSummary).filter((key) =>
    key.endsWith("_error"),
  );
  const ats = sourceSummary.ats as
    | {
        failedSources?: number;
        sources?: Array<{ company?: string; provider?: string; error?: string }>;
      }
    | undefined;
  if (ats?.failedSources) {
    limitations.push(
      ...(ats.sources ?? [])
        .filter((source) => source.error)
        .map(
          (source) =>
            `${source.company ?? "未知公司"} ${source.provider ?? "ATS"}：${source.error}`,
        ),
    );
  }
  return limitations;
}

function safeSalary(record: SalaryRecord) {
  return {
    companyCode: record.companyCode,
    companyName: record.companyName,
    market: record.market,
    year: record.year,
    industry: record.industry,
    medianAnnualSalary: record.medianAnnualSalary,
    averageAnnualSalary: record.averageAnnualSalary,
    sourceUrl: record.sourceUrl,
  };
}

function isApprovedForumUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    return [
      "ptt.cc",
      "dcard.tw",
      "interview.tw",
      "salary.tw",
      "gamer.com.tw",
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function loadCommunityEvidence(runId: string) {
  const db = getDb();
  return db
    .select()
    .from(communityEvidence)
    .where(eq(communityEvidence.runId, runId));
}

function isRecoverableStage(stage: Stage, message: string): boolean {
  if (stage === "salary" || stage === "community" || stage === "analysis") {
    return true;
  }
  return message === "no_matching_jobs" ? false : false;
}

function safeError(value: string): string {
  if (/^Failed query:/i.test(value)) return "database_operation_failed";
  return value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 400);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeSourceSummary(
  sourceSummary: Record<string, unknown>,
): Record<string, { count: number; status: string; note?: string }> {
  const output: Record<
    string,
    { count: number; status: string; note?: string }
  > = {};
  for (const [key, value] of Object.entries(sourceSummary)) {
    if (typeof value === "object" && value) {
      const entry = value as { count?: number; status?: string; note?: string };
      output[key] = {
        count: Number(entry.count ?? 0),
        status: entry.status ?? "unknown",
        note: entry.note,
      };
    }
  }
  return output;
}
