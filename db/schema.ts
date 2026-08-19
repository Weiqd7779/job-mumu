import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`CURRENT_TIMESTAMP`;

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull().default(now),
  lastSeenAt: text("last_seen_at").notNull().default(now),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    title: text("title").notNull(),
    targetRole: text("target_role").notNull(),
    inputType: text("input_type").notNull(),
    inputValue: text("input_value").notNull(),
    configJson: text("config_json").notNull().default("{}"),
    status: text("status").notNull().default("draft"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("projects_user_updated_idx").on(table.userEmail, table.updatedAt),
  ],
);

export const analysisRuns = sqliteTable(
  "analysis_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    userEmail: text("user_email").notNull(),
    status: text("status").notNull().default("queued"),
    currentStage: text("current_stage").notNull().default("intent"),
    progress: integer("progress").notNull().default(0),
    inputType: text("input_type").notNull(),
    inputText: text("input_text").notNull(),
    normalizedIntentJson: text("normalized_intent_json"),
    sampleCount: integer("sample_count").notNull().default(0),
    sourceSummaryJson: text("source_summary_json").notNull().default("{}"),
    resultJson: text("result_json"),
    modelId: text("model_id"),
    skillVersion: text("skill_version").notNull().default("1.0.0"),
    promptHash: text("prompt_hash"),
    estimatedCostUsdMicros: integer("estimated_cost_usd_micros")
      .notNull()
      .default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull().default(now),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("runs_project_created_idx").on(table.projectId, table.createdAt),
    index("runs_user_status_idx").on(table.userEmail, table.status),
  ],
);

export const runStages = sqliteTable(
  "run_stages",
  {
    runId: text("run_id").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.stage] }),
    index("run_stages_status_idx").on(table.status),
  ],
);

export const jobPostings = sqliteTable(
  "job_postings",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceJobId: text("source_job_id"),
    canonicalUrl: text("canonical_url"),
    title: text("title").notNull(),
    company: text("company").notNull().default(""),
    location: text("location").notNull().default(""),
    description: text("description").notNull(),
    requiredText: text("required_text").notNull().default(""),
    preferredText: text("preferred_text").notNull().default(""),
    salaryText: text("salary_text").notNull().default(""),
    publishedAt: text("published_at"),
    fetchedAt: text("fetched_at").notNull().default(now),
    contentHash: text("content_hash").notNull(),
    licenseType: text("license_type").notNull(),
    mayStoreOriginal: integer("may_store_original", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex("jobs_source_hash_uidx").on(table.source, table.contentHash),
    index("jobs_title_idx").on(table.title),
  ],
);

export const projectJobs = sqliteTable(
  "project_jobs",
  {
    projectId: text("project_id").notNull(),
    runId: text("run_id").notNull(),
    jobId: text("job_id").notNull(),
    clusterId: text("cluster_id"),
    included: integer("included", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.jobId] }),
    index("project_jobs_project_idx").on(table.projectId),
  ],
);

export const jobClusters = sqliteTable(
  "job_clusters",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    name: text("name").notNull(),
    reason: text("reason").notNull(),
    representativeTitlesJson: text("representative_titles_json")
      .notNull()
      .default("[]"),
    jobCount: integer("job_count").notNull().default(0),
    included: integer("included", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("clusters_run_idx").on(table.runId, table.sortOrder)],
);

export const skillMentions = sqliteTable(
  "skill_mentions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    jobId: text("job_id").notNull(),
    normalizedSkill: text("normalized_skill").notNull(),
    rawKeyword: text("raw_keyword").notNull(),
    requirementType: text("requirement_type").notNull(),
    evidenceText: text("evidence_text").notNull(),
  },
  (table) => [
    index("skill_mentions_run_skill_idx").on(
      table.runId,
      table.normalizedSkill,
    ),
  ],
);

export const communityEvidence = sqliteTable(
  "community_evidence",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    query: text("query").notNull(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    snippet: text("snippet").notNull(),
    publishedAt: text("published_at"),
    fetchedAt: text("fetched_at").notNull().default(now),
    firsthand: integer("firsthand", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [index("community_run_idx").on(table.runId)],
);

export const salaryCompanies = sqliteTable(
  "salary_companies",
  {
    companyCode: text("company_code").notNull(),
    year: integer("year").notNull(),
    market: text("market").notNull(),
    companyName: text("company_name").notNull(),
    industry: text("industry").notNull().default(""),
    medianAnnualSalary: integer("median_annual_salary"),
    averageAnnualSalary: integer("average_annual_salary"),
    sourceUrl: text("source_url").notNull(),
    fetchedAt: text("fetched_at").notNull().default(now),
  },
  (table) => [
    primaryKey({
      columns: [table.companyCode, table.year, table.market],
    }),
    index("salary_industry_year_idx").on(table.industry, table.year),
  ],
);

export const reportVersions = sqliteTable(
  "report_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    runId: text("run_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    reportJson: text("report_json").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("reports_project_version_uidx").on(
      table.projectId,
      table.versionNumber,
    ),
  ],
);

export const uploads = sqliteTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    projectId: text("project_id").notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().default("uploaded"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [index("uploads_user_project_idx").on(table.userEmail, table.projectId)],
);

export const factCards = sqliteTable(
  "fact_cards",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    projectId: text("project_id"),
    category: text("category").notNull(),
    claim: text("claim").notNull(),
    evidenceJson: text("evidence_json").notNull().default("[]"),
    verificationStatus: text("verification_status")
      .notNull()
      .default("unverified"),
    allowedInResume: integer("allowed_in_resume", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [index("facts_user_idx").on(table.userEmail)],
);

export const resumeVersions = sqliteTable(
  "resume_versions",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    projectId: text("project_id").notNull(),
    reportVersionId: text("report_version_id").notNull(),
    language: text("language").notNull(),
    resumeJson: text("resume_json").notNull(),
    versionNumber: integer("version_number").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("resumes_project_version_uidx").on(
      table.projectId,
      table.versionNumber,
    ),
  ],
);

export const costLedger = sqliteTable(
  "cost_ledger",
  {
    id: text("id").primaryKey(),
    runId: text("run_id"),
    userEmail: text("user_email"),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    queryCount: integer("query_count").notNull().default(0),
    costUsdMicros: integer("cost_usd_micros").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    index("cost_provider_created_idx").on(table.provider, table.createdAt),
  ],
);

export const problemReports = sqliteTable(
  "problem_reports",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    projectId: text("project_id").notNull(),
    runId: text("run_id"),
    category: text("category").notNull(),
    message: text("message").notNull().default(""),
    includeDebugContent: integer("include_debug_content", { mode: "boolean" })
      .notNull()
      .default(false),
    debugExpiresAt: text("debug_expires_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [index("problems_project_idx").on(table.projectId)],
);
