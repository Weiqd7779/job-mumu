import type { NormalizedJob } from "../data/jobs";
import { normalizeCompanyName } from "../data/company-universe";

export type SkillStat = {
  name: string;
  n: number;
  N: number;
  percent: number;
  companyN: number;
  companyTotal: number;
  companyPercent: number;
  requiredN: number;
  preferredN: number;
  rawCount: number;
  evidence: Array<{
    jobIndex: number;
    keyword: string;
    requirementType: "description" | "required" | "preferred";
    text: string;
  }>;
};

type SkillRule = { name: string; patterns: RegExp[] };

const rules: SkillRule[] = [
  skill("JavaScript", /\bjavascript\b|\bes6\+?\b/i),
  skill("TypeScript", /\btypescript\b/i),
  skill("React", /\breact(?:\.?js)?\b|react hooks/i),
  skill("Vue", /\bvue(?:\.?js)?\b/i),
  skill("Angular", /\bangular(?:js)?\b/i),
  skill("HTML／CSS", /\bhtml5?\b|\bcss3?\b|\bscss\b|\bsass\b/i),
  skill("Next.js", /\bnext\.?js\b/i),
  skill("Node.js", /\bnode\.?js\b/i),
  skill("網頁效能", /web performance|網頁效能|core web vitals/i),
  skill("無障礙設計", /accessib(?:le|ility)|\ba11y\b|無障礙/i),
  skill("Design System", /design systems?|component librar(?:y|ies)|設計系統/i),
  skill("Java", /\bjava\b(?!script)/i, /\bspring boot\b|\bspring framework\b/i),
  skill("C#／.NET", /\bc#\b|\.net\b|asp\.net/i),
  skill("Go", /\bgolang\b|\bgo language\b/i),
  skill("Python", /\bpython\b/i),
  skill("SQL", /\bsql\b|\bpostgres(?:ql)?\b|\bmysql\b|\boracle db\b/i),
  skill("NoSQL", /\bnosql\b|\bmongodb\b|\bdynamodb\b|\bredis\b/i),
  skill("REST API", /\brest(?:ful)?\b|api integration|api 串接/i),
  skill("GraphQL", /\bgraphql\b|\bapollo\b/i),
  skill("微服務", /\bmicroservices?\b|微服務/i),
  skill("Git", /\bgit(?:hub|lab)?\b|版本控制/i),
  skill("自動化測試", /unit tests?|integration tests?|test automation|自動化測試/i),
  skill("Playwright／Cypress", /\bplaywright\b|\bcypress\b|\bselenium\b/i),
  skill("CI／CD", /\bci\s*\/?\s*cd\b|continuous integration|continuous deployment/i),
  skill("Docker／容器", /\bdocker\b|\bcontainers?\b|容器化/i),
  skill("Kubernetes", /\bkubernetes\b|\bk8s\b/i),
  skill("雲端平台", /\baws\b|\bgcp\b|\bazure\b|cloud platform|雲端平台/i),
  skill("Observability", /observability|tracing|telemetry|可觀測性/i),
  skill("Terraform／IaC", /\bterraform\b|infrastructure as code|\biac\b/i),
  skill("Linux", /\blinux\b|embedded linux/i),
  skill("RAG／檢索", /\brag\b|retriev\w*|向量檢索|語意搜尋/i),
  skill("LLM", /\bllm\b|large language model|大型語言模型|生成式 ai/i),
  skill("Agent 編排", /\bagent(?:ic)?\b|langgraph|autogen|crewai|tool calling/i),
  skill("機器學習", /machine learning|機器學習|deep learning|深度學習/i),
  skill("資料管線", /\betl\b|\belt\b|data pipeline|資料管線/i),
  skill("資料分析", /data analysis|資料分析|statistical analysis|統計分析/i),
  skill("C／C++", /\bc\+\+(?!\w)|\bc language\b|c語言/i),
  skill("MCU／微控制器", /\bmcu\b|microcontroller|微控制器|\bstm32\b/i),
  skill("RTOS", /\brtos\b|\bfreertos\b|即時作業系統/i),
  skill("硬體除錯", /示波器|邏輯分析儀|硬體除錯|\bjtag\b/i),
  skill("設備維護", /設備維護|機台維護|保養設備|故障排除/i),
  skill("資訊安全", /cybersecurity|information security|資訊安全|資安/i),
  skill("弱點管理", /vulnerability|弱點管理|penetration test|滲透測試/i),
  skill("產品規劃", /product roadmap|product requirements?|產品路線圖|產品需求/i),
  skill("敏捷協作", /\bagile\b|\bscrum\b|敏捷開發/i),
  skill("Figma／原型", /\bfigma\b|wireframe|prototype|線框|原型設計/i),
  skill("SEO／SEM", /\bseo\b|\bsem\b|search engine optimization|搜尋引擎最佳化/i),
  skill("數位行銷分析", /google analytics|\bga4\b|marketing analytics|行銷分析/i),
  skill("Excel／試算表", /\bexcel\b|spreadsheet|試算表/i),
  skill("專案管理", /project management|專案管理|stakeholder management|利害關係人/i),
  skill("護理師證照", /護理師證照|registered nurse|\brn license\b/i),
  skill("臨床照護", /patient care|clinical care|病人照護|臨床照護/i),
];

export function calculateSkillStats(jobs: NormalizedJob[]): SkillStat[] {
  const N = jobs.length;
  const companyKeys = jobs.map((job, index) => {
    const normalized = normalizeCompanyName(job.company);
    return normalized || `job-${index}`;
  });
  const companyTotal = new Set(companyKeys).size;
  return rules
    .map((rule) => calculateRule(rule, jobs, companyKeys, N, companyTotal))
    .filter((stat) => stat.n > 0)
    .sort(
      (left, right) =>
        right.companyN - left.companyN ||
        right.n - left.n ||
        right.rawCount - left.rawCount,
    );
}

function calculateRule(
  rule: SkillRule,
  jobs: NormalizedJob[],
  companyKeys: string[],
  N: number,
  companyTotal: number,
): SkillStat {
  let n = 0;
  let requiredN = 0;
  let preferredN = 0;
  let rawCount = 0;
  const companies = new Set<string>();
  const evidence: SkillStat["evidence"] = [];

  jobs.forEach((job, jobIndex) => {
    const sections = [
      { kind: "description", value: job.description },
      { kind: "required", value: job.requiredText },
      { kind: "preferred", value: job.preferredText },
    ] as const;
    let mentioned = false;
    let required = false;
    let preferred = false;

    for (const section of sections) {
      for (const pattern of rule.patterns) {
        const matches = [...section.value.matchAll(pattern)];
        if (!matches.length) continue;
        mentioned = true;
        required ||= section.kind === "required";
        preferred ||= section.kind === "preferred";
        rawCount += matches.length;
        if (evidence.length < 8) {
          evidence.push({
            jobIndex,
            keyword: matches[0][0],
            requirementType: section.kind,
            text: evidenceWindow(section.value, matches[0].index ?? 0),
          });
        }
      }
    }
    if (mentioned) {
      n += 1;
      companies.add(companyKeys[jobIndex]);
    }
    if (required) requiredN += 1;
    if (preferred) preferredN += 1;
  });

  return {
    name: rule.name,
    n,
    N,
    percent: percent(n, N),
    companyN: companies.size,
    companyTotal,
    companyPercent: percent(companies.size, companyTotal),
    requiredN,
    preferredN,
    rawCount,
    evidence,
  };
}

function skill(name: string, ...patterns: RegExp[]): SkillRule {
  return {
    name,
    patterns: patterns.map(
      (pattern) =>
        new RegExp(pattern.source, [
          ...new Set(`${pattern.flags.replace(/g/g, "")}g`.split("")),
        ].join("")),
    ),
  };
}

function percent(n: number, N: number): number {
  return N ? Math.round((n / N) * 1000) / 10 : 0;
}

function evidenceWindow(value: string, index: number): string {
  const start = Math.max(0, index - 45);
  return value.slice(start, Math.min(value.length, index + 95)).trim();
}
