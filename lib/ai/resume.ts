import { readRuntimeEnv, requireRuntimeEnv } from "../runtime-env";

export type ResumeDraft = {
  title: string;
  summary: string;
  skills: string[];
  experience: Array<{ heading: string; bullets: string[] }>;
  projects: Array<{ heading: string; bullets: string[] }>;
  education: string[];
  evidenceWarnings: string[];
  language: "zh-TW" | "en";
  modelId: string;
  usage: { inputTokens: number; outputTokens: number };
};

const RESUME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "summary",
    "skills",
    "experience",
    "projects",
    "education",
    "evidenceWarnings",
  ],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    skills: { type: "array", items: { type: "string" } },
    experience: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "bullets"],
        properties: {
          heading: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "bullets"],
        properties: {
          heading: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
      },
    },
    education: { type: "array", items: { type: "string" } },
    evidenceWarnings: { type: "array", items: { type: "string" } },
  },
} as const;

export async function createResumeDraft(input: {
  targetRole: string;
  sourceText: string;
  targetSkills: string[];
  language: "zh-TW" | "en";
}): Promise<ResumeDraft> {
  const token = requireRuntimeEnv("FIREWORKS_API_KEY");
  const primaryModel =
    readRuntimeEnv("FIREWORKS_RESUME_MODEL") ??
    readRuntimeEnv("FIREWORKS_ANALYSIS_MODEL") ??
    "accounts/fireworks/models/gpt-oss-120b";
  const fallbackModel =
    readRuntimeEnv("FIREWORKS_FALLBACK_MODEL") ??
    "accounts/fireworks/models/gpt-oss-120b";
  const models = [...new Set([primaryModel, fallbackModel])];
  let lastError: Error | undefined;

  for (const modelId of models) {
    try {
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
            temperature: 0.15,
            max_tokens: 2_200,
            messages: [
              {
                role: "system",
                content: [
                  "你是 Evidence-based Resume Agent。",
                  "只能改寫使用者明確確認的來源事實，不得新增技能、數字、職稱、年資、成果或責任。",
                  "目標職缺的技能僅用來排序與選材；來源中沒有的技能不可寫成使用者具備。",
                  "遇到缺少證據的內容，放進 evidenceWarnings，不要補寫。",
                  "使用 ATS 友善的單欄結構、短句與具體動詞。",
                  input.language === "en"
                    ? "Output professional English."
                    : "使用台灣繁體中文，務實、直接。",
                ].join("\n"),
              },
              {
                role: "user",
                content: JSON.stringify({
                  targetRole: input.targetRole,
                  targetSkills: input.targetSkills,
                  verifiedUserSource: input.sourceText,
                }),
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "evidence_based_resume",
                strict: true,
                schema: RESUME_SCHEMA,
              },
            },
          }),
          signal: AbortSignal.timeout(55_000),
        },
      );
      if (!response.ok) {
        throw new Error(`resume_model_http_${response.status}`);
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("resume_model_empty_response");
      const parsed =
        parseJsonObject<
          Omit<ResumeDraft, "language" | "modelId" | "usage">
        >(content);
      return enforceEvidenceBoundary({
        ...parsed,
        language: input.language,
        modelId,
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
        },
      }, input);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("resume_model_failed");
    }
  }

  throw lastError ?? new Error("resume_model_failed");
}

/**
 * The model may organize and rank material, but it is not trusted to create
 * resume claims. Final claims are rebuilt from user-confirmed source sentences.
 */
function enforceEvidenceBoundary(
  draft: ResumeDraft,
  input: {
    targetRole: string;
    sourceText: string;
    targetSkills: string[];
    language: "zh-TW" | "en";
  },
): ResumeDraft {
  const sentences = input.sourceText
    .split(/(?<=[。！？.!?])\s*|\r?\n+/)
    .map((sentence) =>
      sentence
        .trim()
        .replace(/^(?:測試用)?(?:確認)?事實[：:]\s*/u, "")
        .replace(/^[-*•]\s*/, ""),
    )
    .filter((sentence) => sentence.length >= 4);
  const warningSignals = /未提供|不確定|請勿|不可|沒有|缺少|unknown|not provided/i;
  const verifiedFacts = sentences.filter(
    (sentence) => !warningSignals.test(sentence),
  );
  const sourceLower = input.sourceText.toLowerCase();
  const skills = input.targetSkills.filter((skill) =>
    skill
      .split(/[／/、·]+/)
      .map((variant) => variant.trim())
      .filter((variant) => variant.length >= 2)
      .some((variant) => sourceLower.includes(variant.toLowerCase())),
  );
  const educationFacts = verifiedFacts.filter((fact) =>
    /學歷|學位|大學|研究所|畢業|education|degree|university/i.test(fact),
  );
  const workFacts = verifiedFacts.filter((fact) => !educationFacts.includes(fact));
  const warnings = sentences.filter((sentence) => warningSignals.test(sentence));
  if (!educationFacts.length) {
    warnings.push(
      input.language === "en"
        ? "Education evidence was not provided."
        : "尚未提供可確認的學歷資料。",
    );
  }
  if (
    !/\d/.test(input.sourceText) &&
    !warnings.some((warning) => /量化|quantitative/i.test(warning))
  ) {
    warnings.push(
      input.language === "en"
        ? "No verified quantitative result was provided."
        : "尚未提供可確認的量化成果。",
    );
  }

  return {
    ...draft,
    title: input.targetRole,
    summary:
      verifiedFacts
        .slice(0, 3)
        .map((fact) => fact.replace(/[。！？.!?]+$/, ""))
        .join(input.language === "en" ? ". " : "；") +
      (verifiedFacts.length ? (input.language === "en" ? "." : "。") : ""),
    skills,
    experience: workFacts.length
      ? [
          {
            heading:
              input.language === "en"
                ? "Verified experience and projects"
                : "已確認的經歷與專案",
            bullets: workFacts,
          },
        ]
      : [],
    projects: [],
    education: educationFacts,
    evidenceWarnings: [...new Set(warnings)],
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
  throw new Error("resume_model_invalid_json");
}
