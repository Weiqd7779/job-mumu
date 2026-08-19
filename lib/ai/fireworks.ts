import { readRuntimeEnv, requireRuntimeEnv } from "../runtime-env";
import type { AgentCommunityContext } from "../analysis/community";
import { sha256Text } from "../ids";
import {
  CAREER_ANALYSIS_OUTPUT_SCHEMA,
  CAREER_ANALYSIS_SKILL_NAME,
  CAREER_ANALYSIS_SKILL_VERSION,
  CAREER_ANALYSIS_SYSTEM_PROMPT,
} from "../skills/career-analysis";

type ChatCompletion = {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type AgentEvidenceItem = {
  id: string;
  kind: "fact" | "inference" | "community_signal";
  text: string;
  evidenceIds: string[];
  confidence: "high" | "medium" | "low";
};

export type AgentSummary = {
  summary: string;
  facts: AgentEvidenceItem[];
  inferences: AgentEvidenceItem[];
  communitySignals: Array<
    AgentEvidenceItem & {
      discussionCount: number;
      sourceCount: number;
      firsthandCount: number;
      scope: "role_general" | "company_specific" | "insufficient";
    }
  >;
  recommendations: Array<{
    priority: number;
    title: string;
    reason: string;
    evidenceIds: string[];
  }>;
  limitations: string[];
  citations: Array<{
    id: string;
    source: string;
    url: string;
    publishedAt: string | null;
  }>;
  confidence: "high" | "medium" | "low";
  skillVersion: string;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number };
};

export type AgentResponseTrace = {
  status: "validated";
  skillName: string;
  skillVersion: string;
  promptHash: string;
  modelId: string;
  rawResponse: string;
  checks: {
    schemaValidated: true;
    skillMetadataMatched: true;
    evidenceIdsValid: true;
    statisticsReferenced: true;
    percentagesHaveDenominators: true;
    statisticFactsExact: true;
    citationsValid: true;
    claimsScopedToSample: true;
    namedSkillsCited: true;
  };
};

type RawAgentOutput = {
  summary: string;
  facts: RawEvidenceItem[];
  inferences: RawEvidenceItem[];
  community_signals: Array<
    RawEvidenceItem & {
      discussion_count: number;
      source_count: number;
      firsthand_count: number;
      scope: "role_general" | "company_specific" | "insufficient";
    }
  >;
  recommendations: Array<{
    priority: number;
    title: string;
    reason: string;
    evidence_ids: string[];
  }>;
  limitations: string[];
  citations: Array<{
    id: string;
    source: string;
    url: string;
    published_at: string | null;
  }>;
  confidence: "high" | "medium" | "low";
  skill_version: string;
  model_id: string;
};

type RawEvidenceItem = {
  id: string;
  kind: "fact" | "inference" | "community_signal";
  text: string;
  evidence_ids: string[];
  confidence: "high" | "medium" | "low";
};

export async function createCareerSummary(input: {
  targetRole: string;
  sampleCount: number;
  calculatedAt: string;
  skillStats: Array<{
    id: string;
    name: string;
    n: number;
    N: number;
    percent: number;
    companyN: number;
    companyTotal: number;
    companyPercent: number;
    requiredN: number;
    preferredN: number;
  }>;
  community: AgentCommunityContext;
  sourceLimitations: string[];
}): Promise<{ agent: AgentSummary; trace: AgentResponseTrace }> {
  const token = requireRuntimeEnv("FIREWORKS_API_KEY");
  const primaryModel =
    readRuntimeEnv("FIREWORKS_ANALYSIS_MODEL") ??
    "accounts/fireworks/models/kimi-k2p6";
  const fallbackModel =
    readRuntimeEnv("FIREWORKS_FALLBACK_MODEL") ??
    "accounts/fireworks/models/gpt-oss-120b";
  const promptHash = await sha256Text(CAREER_ANALYSIS_SYSTEM_PROMPT);
  const requiredConfidence =
    input.sampleCount < 20
      ? "low"
      : input.sampleCount < 50
        ? "medium"
        : "high";
  const allowedEvidenceIds = new Set([
    ...input.skillStats.map((stat) => stat.id),
    ...input.community.evidence.map((item) => item.id),
  ]);
  const statisticFactTexts = new Map(
    input.skillStats.map((stat) => [stat.id, formatStatisticFact(stat)]),
  );
  const statisticSkillTokens = new Map(
    input.skillStats.map((stat) => [
      stat.id,
      stat.name
        .normalize("NFKC")
        .toLowerCase()
        .split(/[／/]/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3),
    ]),
  );
  const communityCitations = new Map(
    input.community.evidence.map((item) => [
      item.id,
      {
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
      },
    ]),
  );
  const totalUsage = { prompt_tokens: 0, completion_tokens: 0 };

  let lastError: unknown;
  for (const modelId of [...new Set([primaryModel, fallbackModel])]) {
    let repair:
      | { error: string; rawResponse: string }
      | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let rawResponse = "";
      try {
        const payload = {
          task: "依已計算統計與證據產生職涯分析；不得重新計算數字。",
          runtime_metadata: {
            skill_name: CAREER_ANALYSIS_SKILL_NAME,
            skill_version: CAREER_ANALYSIS_SKILL_VERSION,
            model_id: modelId,
            prompt_hash: promptHash,
            calculated_at: input.calculatedAt,
          },
          allowed_evidence_ids: [...allowedEvidenceIds],
          target_role: input.targetRole,
          sample_count: input.sampleCount,
          sampled_company_count: input.skillStats[0]?.companyTotal ?? 0,
          required_overall_confidence: requiredConfidence,
          facts_must_copy_fact_text_exactly: true,
          skills: input.skillStats.map((stat) => ({
            id: stat.id,
            name: stat.name,
            fact_text: statisticFactTexts.get(stat.id),
            n: stat.n,
            N: stat.N,
            percent: stat.percent,
            company_mention_n: stat.companyN,
            sampled_company_total: stat.companyTotal,
            company_percent: stat.companyPercent,
            required_job_n: stat.requiredN,
            preferred_job_n: stat.preferredN,
          })),
          community: input.community,
          source_limitations: input.sourceLimitations,
        };
        const messages = [
          { role: "system", content: CAREER_ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
          ...(repair
            ? [
                { role: "assistant", content: repair.rawResponse },
                {
                  role: "user",
                  content: [
                    `The deterministic validator rejected the previous JSON with: ${repair.error}.`,
                    "Return the complete corrected JSON object.",
                    "Copy each selected fact_text exactly and cite only that fact's one skill ID.",
                    "For every skill named in an inference or recommendation, include that skill's evidence ID.",
                    "Remove all percentages from summary, inferences, and recommendation reasons.",
                    "Outside the copied facts, remove all requirement-classification claims and the words 必備, 必需, 必須, 硬性, 門檻, 彈性, 加分, 未標示, and 未被標示.",
                    "Do not interpret required_job_n=0 as absence, flexible employer requirements, fewer hard requirements, or learning flexibility.",
                    "Use no citations unless an exact community evidence URL was supplied.",
                    "Do not make claims about interview success, hiring outcomes, or the whole Taiwan market.",
                  ].join("\n"),
                },
              ]
            : []),
        ];
        const response = await fetch(
          "https://api.fireworks.ai/inference/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: modelId,
              temperature: 0.1,
              max_tokens: 3200,
              messages,
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "career_analysis",
                  strict: true,
                  schema: CAREER_ANALYSIS_OUTPUT_SCHEMA,
                },
              },
            }),
            signal: AbortSignal.timeout(55_000),
          },
        );
        if (!response.ok) throw new Error(`fireworks_http_${response.status}`);
        const body = (await response.json()) as ChatCompletion;
        totalUsage.prompt_tokens += body.usage?.prompt_tokens ?? 0;
        totalUsage.completion_tokens += body.usage?.completion_tokens ?? 0;
        if (body.choices?.[0]?.finish_reason === "length") {
          throw new Error("fireworks_response_truncated");
        }
        rawResponse = body.choices?.[0]?.message?.content?.trim() ?? "";
        if (!rawResponse) throw new Error("fireworks_empty_response");
        const parsed = parseJsonObject<RawAgentOutput>(rawResponse);
        validateAgentOutput(parsed, {
          modelId,
          allowedEvidenceIds,
          statisticFactTexts,
          statisticSkillTokens,
          communityCitations,
          topStatisticId: input.skillStats[0]?.id,
          communityThresholdMet: input.community.thresholdMet,
          requiredConfidence,
        });
        return {
          agent: mapAgentOutput(parsed, modelId, totalUsage),
          trace: {
            status: "validated",
            skillName: CAREER_ANALYSIS_SKILL_NAME,
            skillVersion: CAREER_ANALYSIS_SKILL_VERSION,
            promptHash,
            modelId,
            rawResponse,
            checks: {
              schemaValidated: true,
              skillMetadataMatched: true,
              evidenceIdsValid: true,
              statisticsReferenced: true,
              percentagesHaveDenominators: true,
              statisticFactsExact: true,
              citationsValid: true,
              claimsScopedToSample: true,
              namedSkillsCited: true,
            },
          },
        };
      } catch (error) {
        lastError = error;
        if (rawResponse) {
          repair = {
            error: error instanceof Error ? error.message : "validation_error",
            rawResponse,
          };
        }
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("fireworks_analysis_failed");
}

function formatStatisticFact(stat: {
  name: string;
  n: number;
  N: number;
  percent: number;
  companyN: number;
  companyTotal: number;
  companyPercent: number;
  requiredN: number;
  preferredN: number;
}): string {
  return `${stat.name}：出現在 ${stat.n}/${stat.N} 份 JD（${stat.percent}%）；由 ${stat.companyN}/${stat.companyTotal} 家抽樣公司提及（${stat.companyPercent}%）；其中明確分類為必備 ${stat.requiredN}/${stat.N}、加分 ${stat.preferredN}/${stat.N}。`;
}

function validateAgentOutput(
  output: RawAgentOutput,
  options: {
    modelId: string;
    allowedEvidenceIds: Set<string>;
    statisticFactTexts: Map<string, string>;
    statisticSkillTokens: Map<string, string[]>;
    communityCitations: Map<
      string,
      { source: string; url: string; publishedAt: string | null }
    >;
    topStatisticId?: string;
    communityThresholdMet: boolean;
    requiredConfidence: "high" | "medium" | "low";
  },
) {
  if (
    !output.summary ||
    !Array.isArray(output.facts) ||
    !Array.isArray(output.inferences) ||
    !Array.isArray(output.community_signals) ||
    !Array.isArray(output.recommendations) ||
    !Array.isArray(output.limitations) ||
    !Array.isArray(output.citations) ||
    !["high", "medium", "low"].includes(output.confidence) ||
    output.confidence !== options.requiredConfidence
  ) {
    throw new Error("fireworks_schema_validation_failed");
  }
  if (
    output.facts.some((item) => {
      if (item.evidence_ids.length !== 1) return true;
      return (
        options.statisticFactTexts.get(item.evidence_ids[0]) !== item.text
      );
    })
  ) {
    throw new Error("fireworks_statistic_fact_mismatch");
  }
  if (
    output.facts.length < 1 ||
    output.facts.length > 5 ||
    output.inferences.length > 3 ||
    output.community_signals.length > 3 ||
    output.recommendations.length < 1 ||
    output.recommendations.length > 4 ||
    output.limitations.length > 6 ||
    output.citations.length > 12 ||
    output.facts.some((item) => item.kind !== "fact") ||
    output.inferences.some((item) => item.kind !== "inference") ||
    output.inferences.some((item) => item.evidence_ids.length < 1) ||
    output.community_signals.some(
      (item) =>
        item.kind !== "community_signal" || item.evidence_ids.length < 1,
    ) ||
    output.recommendations.some(
      (item) =>
        !Number.isInteger(item.priority) ||
        item.priority < 1 ||
        !item.title ||
        !item.reason ||
        !Array.isArray(item.evidence_ids) ||
        item.evidence_ids.length < 1,
    )
  ) {
    throw new Error("fireworks_schema_validation_failed");
  }
  if (
    output.skill_version !== CAREER_ANALYSIS_SKILL_VERSION ||
    output.model_id !== options.modelId
  ) {
    throw new Error("fireworks_skill_metadata_mismatch");
  }

  const referenced = [
    ...output.facts.flatMap((item) => item.evidence_ids),
    ...output.inferences.flatMap((item) => item.evidence_ids),
    ...output.community_signals.flatMap((item) => item.evidence_ids),
    ...output.recommendations.flatMap((item) => item.evidence_ids),
    ...output.citations.map((item) => item.id),
  ];
  if (referenced.some((id) => !options.allowedEvidenceIds.has(id))) {
    throw new Error("fireworks_unknown_evidence_id");
  }
  const narrativeEvidenceItems = [
    ...output.inferences.map((item) => ({
      text: item.text,
      evidenceIds: item.evidence_ids,
    })),
    ...output.recommendations.map((item) => ({
      text: `${item.title} ${item.reason}`,
      evidenceIds: item.evidence_ids,
    })),
  ];
  if (
    narrativeEvidenceItems.some((item) => {
      const text = item.text.normalize("NFKC").toLowerCase();
      return [...options.statisticSkillTokens].some(
        ([id, tokens]) =>
          tokens.some((token) => text.includes(token)) &&
          !item.evidenceIds.includes(id),
      );
    })
  ) {
    throw new Error("fireworks_named_skill_missing_evidence");
  }
  if (
    output.citations.some((item) => {
      const expected = options.communityCitations.get(item.id);
      return (
        !expected ||
        item.source !== expected.source ||
        item.url !== expected.url ||
        item.published_at !== expected.publishedAt
      );
    })
  ) {
    throw new Error("fireworks_invalid_citation");
  }
  if (
    options.topStatisticId &&
    !referenced.includes(options.topStatisticId)
  ) {
    throw new Error("fireworks_statistics_not_referenced");
  }
  const statisticalTexts = [
    output.summary,
    ...output.facts.map((item) => item.text),
    ...output.inferences.map((item) => item.text),
    ...output.recommendations.map((item) => item.reason),
  ].filter((text) => /%|百分比/.test(text));
  if (
    statisticalTexts.some((text) => {
      const percentages = text.match(/%|％|百分比/g)?.length ?? 0;
      const denominators = text.match(/\b\d+\s*\/\s*\d+\b/g)?.length ?? 0;
      return denominators < percentages;
    })
  ) {
    throw new Error("fireworks_percentage_without_denominator");
  }
  const unsupportedOutcomeText = [
    output.summary,
    ...output.inferences.map((item) => item.text),
    ...output.recommendations.map((item) => item.reason),
  ].join("\n");
  if (
    /求職成功率|面試通過率|保證(?:錄取|面試)|直接影響.*(?:錄取|面試)/.test(
      unsupportedOutcomeText,
    )
  ) {
    throw new Error("fireworks_unsupported_outcome_claim");
  }
  const nonFactText = [
    ...output.inferences.map((item) => item.text),
    ...output.recommendations.map((item) => item.reason),
  ];
  if (
    [output.summary, ...nonFactText].some((text) =>
      /必備|必需|必須|硬性|門檻|彈性|加分|未.*標示|需求較為多元/.test(
        text,
      ),
    )
  ) {
    throw new Error("fireworks_requirement_classification_overreach");
  }
  if (
    nonFactText.some((text) =>
      /已普遍|業界趨勢|台灣市場|台灣前端工程師|台灣韌體工程師/.test(
        text,
      ),
    )
  ) {
    throw new Error("fireworks_market_overgeneralization");
  }
  if (
    /未(?:將|見|被|有|列).*?(?:必需|必備)|(?:所有|任何).*?(?:未|不).*?(?:必需|必備)|硬性要求較少|要求較為彈性|學習彈性/.test(
      unsupportedOutcomeText,
    )
  ) {
    throw new Error("fireworks_missing_requirement_overreach");
  }
  if (
    !options.communityThresholdMet &&
    output.community_signals.length > 0
  ) {
    throw new Error("fireworks_community_threshold_violation");
  }
}

function mapAgentOutput(
  output: RawAgentOutput,
  modelId: string,
  usage: ChatCompletion["usage"],
): AgentSummary {
  const mapEvidence = (item: RawEvidenceItem): AgentEvidenceItem => ({
    id: item.id,
    kind: item.kind,
    text: item.text,
    evidenceIds: item.evidence_ids,
    confidence: item.confidence,
  });
  return {
    summary: output.summary,
    facts: output.facts.map(mapEvidence),
    inferences: output.inferences.map(mapEvidence),
    communitySignals: output.community_signals.map((item) => ({
      ...mapEvidence(item),
      discussionCount: item.discussion_count,
      sourceCount: item.source_count,
      firsthandCount: item.firsthand_count,
      scope: item.scope,
    })),
    recommendations: output.recommendations.map((item) => ({
      priority: item.priority,
      title: item.title,
      reason: item.reason,
      evidenceIds: item.evidence_ids,
    })),
    limitations: output.limitations,
    citations: output.citations.map((item) => ({
      id: item.id,
      source: item.source,
      url: item.url,
      publishedAt: item.published_at,
    })),
    confidence: output.confidence,
    skillVersion: CAREER_ANALYSIS_SKILL_VERSION,
    modelId,
    usage: {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
    },
  };
}

function parseJsonObject<T>(content: string): T {
  const candidates = [
    content.trim(),
    content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next bounded representation.
    }
  }
  throw new Error("fireworks_invalid_json");
}
