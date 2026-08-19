import type { NormalizedJob } from "../data/jobs";

export type RoleMatch = {
  profileId: string;
  score: number;
  confidence: "high" | "medium" | "low";
  matched: boolean;
  evidence: string[];
};

type RoleProfile = {
  id: string;
  targetPattern: RegExp;
  titlePatterns: RegExp[];
  responsibilityPatterns: RegExp[];
  negativePatterns?: RegExp[];
  searchTerms: string[];
};

const profiles: RoleProfile[] = [
  {
    id: "frontend",
    targetPattern: /(前端|front[\s-]?end|frontend|web\s*(?:ui|developer|engineer))/i,
    titlePatterns: [
      /front[\s-]?end/i,
      /\bweb\s*(?:ui|developer|engineer)\b/i,
      /網頁(?:前端|工程)/i,
    ],
    responsibilityPatterns: [
      /\breact(?:\.?js)?\b/i,
      /\bvue(?:\.?js)?\b/i,
      /\bangular(?:js)?\b/i,
      /browser|瀏覽器/i,
      /web\s*(?:application|interface)|網頁介面|使用者介面/i,
    ],
    negativePatterns: [/ui\/?ux designer|visual designer|純.*設計/i],
    searchTerms: ["frontend", "web"],
  },
  {
    id: "backend",
    targetPattern: /(後端|back[\s-]?end|backend|server[\s-]?side)/i,
    titlePatterns: [/back[\s-]?end/i, /server[\s-]?side/i, /後端/i],
    responsibilityPatterns: [
      /microservices?|微服務/i,
      /server[- ]side|伺服器端/i,
      /rest(?:ful)?\s*api|後端\s*api/i,
      /database|資料庫/i,
    ],
    negativePatterns: [/frontend only|純前端/i],
    searchTerms: ["backend", "server"],
  },
  {
    id: "fullstack",
    targetPattern: /(全端|full[\s-]?stack|fullstack)/i,
    titlePatterns: [/full[\s-]?stack/i, /全端/i],
    responsibilityPatterns: [
      /frontend.*backend|backend.*frontend/i,
      /前端.*後端|後端.*前端/i,
      /react.*(?:node|java|python)|(?:node|java|python).*react/i,
    ],
    searchTerms: ["full stack", "web"],
  },
  {
    id: "mobile",
    targetPattern: /(行動應用|mobile|ios|android|app\s*(?:developer|engineer))/i,
    titlePatterns: [/\bios\b/i, /\bandroid\b/i, /\bmobile\b/i, /行動應用/i],
    responsibilityPatterns: [
      /\bswift\b|\bkotlin\b/i,
      /react native|flutter/i,
      /mobile application|行動應用/i,
    ],
    searchTerms: ["mobile", "iOS", "Android"],
  },
  {
    id: "data-engineering",
    targetPattern: /(資料工程|data\s*engineer|etl|資料平台)/i,
    titlePatterns: [/data\s*engineer/i, /資料工程/i, /data platform/i],
    responsibilityPatterns: [
      /\betl\b|\belt\b/i,
      /data pipeline|資料管線/i,
      /data warehouse|資料倉儲/i,
      /\bspark\b|\bairflow\b/i,
    ],
    searchTerms: ["data engineer", "data platform"],
  },
  {
    id: "data-science",
    targetPattern: /(資料科學|data\s*scientist|數據科學)/i,
    titlePatterns: [/data\s*scientist/i, /資料科學|數據科學/i],
    responsibilityPatterns: [
      /statistical model|統計模型/i,
      /experimentation|a\/b test|實驗設計/i,
      /predictive model|預測模型/i,
    ],
    searchTerms: ["data scientist", "data science"],
  },
  {
    id: "ai-ml",
    targetPattern: /(ai|人工智慧|machine learning|機器學習|ml\s*engineer|llm|生成式)/i,
    titlePatterns: [
      /\bai\b.*(?:engineer|developer)/i,
      /machine learning|ml engineer/i,
      /人工智慧|機器學習|生成式/i,
    ],
    responsibilityPatterns: [
      /\bllm\b|\brag\b|large language model/i,
      /model training|模型訓練/i,
      /model serving|模型部署/i,
      /deep learning|深度學習/i,
    ],
    searchTerms: ["AI engineer", "machine learning"],
  },
  {
    id: "devops",
    targetPattern: /(devops|sre|site reliability|平台工程|cloud engineer|雲端工程)/i,
    titlePatterns: [/devops|\bsre\b|site reliability/i, /平台工程|雲端工程/i],
    responsibilityPatterns: [
      /kubernetes|\bk8s\b/i,
      /infrastructure as code|terraform/i,
      /ci\/?cd|continuous deployment/i,
      /observability|可觀測性/i,
    ],
    searchTerms: ["DevOps", "SRE"],
  },
  {
    id: "cybersecurity",
    targetPattern: /(資安|cyber\s*security|cybersecurity|security engineer|資訊安全)/i,
    titlePatterns: [/security engineer|cyber\s*security/i, /資安|資訊安全/i],
    responsibilityPatterns: [
      /incident response|事件應變/i,
      /vulnerability|弱點/i,
      /threat detection|威脅偵測/i,
      /penetration test|滲透測試/i,
    ],
    searchTerms: ["security engineer", "cybersecurity"],
  },
  {
    id: "firmware",
    targetPattern: /(韌體|firmware|embedded|嵌入式)/i,
    titlePatterns: [
      /\b(?:firmware|embedded)\s+(?:software\s+|systems?\s+)?(?:engineer|developer|architect)\b/i,
      /\b(?:engineer|architect)\b.*\b(?:firmware|embedded)\b/i,
      /韌體(?:軟體)?工程|嵌入式(?:軟體)?工程/i,
    ],
    responsibilityPatterns: [
      /\bmcu\b|microcontroller|微控制器/i,
      /\brtos\b/i,
      /device driver|驅動程式/i,
      /embedded linux/i,
    ],
    searchTerms: ["firmware", "embedded"],
  },
  {
    id: "qa",
    targetPattern: /(測試工程|qa engineer|quality assurance|test automation|軟體測試)/i,
    titlePatterns: [/qa engineer|test engineer|quality assurance/i, /測試工程/i],
    responsibilityPatterns: [
      /test automation|自動化測試/i,
      /test plan|測試計畫/i,
      /selenium|cypress|playwright/i,
    ],
    searchTerms: ["QA engineer", "test automation"],
  },
  {
    id: "product",
    targetPattern: /(產品經理|product manager|product owner)/i,
    titlePatterns: [/product manager|product owner/i, /產品經理/i],
    responsibilityPatterns: [
      /product roadmap|產品路線圖/i,
      /user research|使用者研究/i,
      /product requirements?|產品需求/i,
    ],
    searchTerms: ["product manager"],
  },
  {
    id: "uiux",
    targetPattern: /(ui\/?ux|ux designer|ui designer|產品設計|互動設計)/i,
    titlePatterns: [/ui\/?ux|ux designer|ui designer/i, /產品設計|互動設計/i],
    responsibilityPatterns: [
      /\bfigma\b/i,
      /wireframe|prototype|線框|原型/i,
      /design system|設計系統/i,
    ],
    negativePatterns: [/frontend engineer|前端工程/i],
    searchTerms: ["UX designer", "product designer"],
  },
  {
    id: "marketing",
    targetPattern: /(行銷|marketing|growth|品牌企劃)/i,
    titlePatterns: [/\bmarketing\b|\bgrowth\b/i, /行銷|品牌企劃/i],
    responsibilityPatterns: [
      /campaign|行銷活動/i,
      /seo|sem|內容行銷/i,
      /brand strategy|品牌策略/i,
    ],
    searchTerms: ["marketing", "growth"],
  },
  {
    id: "nursing",
    targetPattern: /(護理師|護理人員|nurse|nursing)/i,
    titlePatterns: [/\bnurse\b|\bnursing\b/i, /護理師|護理人員/i],
    responsibilityPatterns: [
      /patient care|病人照護/i,
      /clinical|臨床/i,
      /nursing license|護理師證照/i,
    ],
    searchTerms: ["nurse", "nursing"],
  },
  {
    id: "equipment",
    targetPattern: /(設備工程|equipment engineer|機台工程)/i,
    titlePatterns: [/equipment engineer/i, /設備工程|機台工程/i],
    responsibilityPatterns: [
      /preventive maintenance|預防保養/i,
      /troubleshoot.*equipment|設備.*故障排除/i,
      /機台維護|設備維護/i,
    ],
    searchTerms: ["equipment engineer"],
  },
  {
    id: "finance-accounting",
    targetPattern: /(會計|財務分析|accountant|financial analyst|finance)/i,
    titlePatterns: [/accountant|financial analyst|finance/i, /會計|財務分析/i],
    responsibilityPatterns: [
      /financial statement|財務報表/i,
      /budget|預算/i,
      /audit|審計/i,
    ],
    searchTerms: ["financial analyst", "accountant"],
  },
  {
    id: "sales",
    targetPattern: /(業務|sales|account executive|business development)/i,
    titlePatterns: [/account executive|\bsales\b|business development/i, /業務/i],
    responsibilityPatterns: [
      /pipeline|商機/i,
      /quota|業績目標/i,
      /customer relationship|客戶關係/i,
    ],
    searchTerms: ["sales", "account executive"],
  },
];

const stopTokens = new Set([
  "工程師",
  "人員",
  "專員",
  "經理",
  "engineer",
  "developer",
  "specialist",
  "manager",
  "台灣",
  "taiwan",
]);

export function matchJobToRole(
  targetRole: string,
  job: Pick<NormalizedJob, "title" | "description" | "requiredText" | "preferredText">,
): RoleMatch {
  const title = job.title.trim();
  const body = [job.description, job.requiredText, job.preferredText]
    .filter(Boolean)
    .join("\n");
  const profile = profiles.find((candidate) =>
    candidate.targetPattern.test(targetRole),
  );
  const evidence: string[] = [];
  let score = 0;

  const normalizedTarget = normalize(targetRole);
  const normalizedTitle = normalize(title);
  if (
    normalizedTarget.length >= 2 &&
    (normalizedTitle.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedTitle))
  ) {
    score += 80;
    evidence.push("職稱直接對應搜尋職業");
  }

  const targetTokens = tokenize(targetRole);
  const titleTokenHits = targetTokens.filter((token) =>
    normalizedTitle.includes(token),
  );
  const bodyTokenHits = targetTokens.filter((token) =>
    normalize(body).includes(token),
  );
  if (targetTokens.length) {
    const titleRatio = titleTokenHits.length / targetTokens.length;
    const bodyRatio = bodyTokenHits.length / targetTokens.length;
    score += Math.round(titleRatio * 55 + bodyRatio * 20);
    if (titleTokenHits.length) evidence.push(`職稱命中：${titleTokenHits.join("、")}`);
    if (bodyTokenHits.length) evidence.push(`JD 命中：${bodyTokenHits.join("、")}`);
  }

  if (profile) {
    const titleMatches = profile.titlePatterns.filter((pattern) =>
      pattern.test(title),
    );
    const responsibilityMatches = profile.responsibilityPatterns.filter(
      (pattern) => pattern.test(body),
    );
    const negativeMatches = (profile.negativePatterns ?? []).filter((pattern) =>
      pattern.test(title),
    );
    if (titleMatches.length) {
      score += 65;
      evidence.push(`職業族群職稱符合 ${profile.id}`);
    }
    if (responsibilityMatches.length) {
      score += Math.min(35, responsibilityMatches.length * 10);
      evidence.push(`工作內容有 ${responsibilityMatches.length} 項核心證據`);
    }
    if (negativeMatches.length) {
      score -= negativeMatches.length * 45;
      evidence.push(`有 ${negativeMatches.length} 項排除證據`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return {
    profileId: profile?.id ?? "generic",
    score,
    confidence: score >= 75 ? "high" : score >= 55 ? "medium" : "low",
    matched: score >= 45,
    evidence,
  };
}

export function buildRoleSearchQueries(targetRole: string): string[] {
  const profile = profiles.find((candidate) =>
    candidate.targetPattern.test(targetRole),
  );
  const terms = profile?.searchTerms ?? [targetRole.trim()];
  return [...new Set(terms.filter(Boolean).map((term) => `${term} Taiwan`))].slice(
    0,
    2,
  );
}

export function roleSelectionScore(
  targetRole: string,
  job: NormalizedJob,
): number {
  const relevance = matchJobToRole(targetRole, job).score * 100;
  const sourceWeight =
    job.source === "taiwan_jobs" || job.source === "user_jd" ? 0 : 1_000;
  const published = job.publishedAt
    ? Date.parse(job.publishedAt)
    : Number.NEGATIVE_INFINITY;
  const freshness = Number.isFinite(published)
    ? Math.max(0, 500 - Math.floor((Date.now() - published) / 86_400_000))
    : 0;
  return relevance + sourceWeight + freshness;
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      normalize(value)
        .split(/\s+/)
        .filter((token) => token.length >= 2 && !stopTokens.has(token)),
    ),
  ];
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
