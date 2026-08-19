import universeJson from "./taiwan-company-universe.json";

export type CompanyMarket =
  | "TWSE"
  | "TPEx"
  | "overseas-listed"
  | "foreign-subsidiary"
  | "private"
  | "nonprofit";

export type CompanyPriority = "focus" | "core" | "diversity";

export type CareerSourceProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "recruitee"
  | "workday"
  | "custom";

export type CareerSourceConfig = {
  id: string;
  provider: CareerSourceProvider;
  enabled: boolean;
  boardToken?: string;
  endpoint?: string;
};

export type CompanyUniverseEntry = {
  id: string;
  displayName: string;
  nameZh: string;
  aliases: string[];
  market: CompanyMarket;
  stockCode: string | null;
  industryGroup: string;
  segment: string;
  priority: CompanyPriority;
  careersUrl: string;
  careerSources: CareerSourceConfig[];
};

type CompanyUniverseFile = {
  version: string;
  companyCap: number;
  selectionPolicy: {
    purpose: string;
    listedSources: string[];
    listedSelection: string;
    additionalSelection: string;
    rule: string;
  };
  companies: CompanyUniverseEntry[];
};

const universe = universeJson as unknown as CompanyUniverseFile;

export const COMPANY_UNIVERSE_VERSION = universe.version;
export const COMPANY_JOB_CAP = universe.companyCap;
export const COMPANY_UNIVERSE_POLICY = universe.selectionPolicy;
export const TAIWAN_COMPANY_UNIVERSE = universe.companies;

export function findCompanyUniverseEntry(
  companyName: string,
): CompanyUniverseEntry | null {
  const query = normalizeCompanyName(companyName);
  if (!query) return null;

  let partialMatch: CompanyUniverseEntry | null = null;
  for (const company of TAIWAN_COMPANY_UNIVERSE) {
    const candidates = [
      company.displayName,
      company.nameZh,
      ...company.aliases,
    ]
      .map(normalizeCompanyName)
      .filter(Boolean);
    if (candidates.includes(query)) return company;
    if (
      !partialMatch &&
      candidates.some(
        (candidate) =>
          Math.min(candidate.length, query.length) >= 3 &&
          (candidate.includes(query) || query.includes(candidate)),
      )
    ) {
      partialMatch = company;
    }
  }
  return partialMatch;
}

export function applyCompanyJobCap<T extends { company: string }>(
  jobs: T[],
  maxPerCompany = COMPANY_JOB_CAP,
  rank: (job: T) => number = () => 0,
): {
  jobs: T[];
  beforeCount: number;
  afterCount: number;
  removedCount: number;
  companyCount: number;
  largestCompanyCount: number;
} {
  const safeCap = Math.max(1, Math.floor(maxPerCompany));
  const counts = new Map<string, number>();
  const capped: T[] = [];
  const ranked = jobs
    .map((job, originalIndex) => ({
      job,
      originalIndex,
      score: finiteScore(rank(job)),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.originalIndex - right.originalIndex,
    );

  for (const { job } of ranked) {
    const key =
      normalizeCompanyName(job.company) ||
      `unknown:${String(job.company).trim().toLowerCase()}`;
    const count = counts.get(key) ?? 0;
    if (count >= safeCap) continue;
    counts.set(key, count + 1);
    capped.push(job);
  }

  return {
    jobs: capped,
    beforeCount: jobs.length,
    afterCount: capped.length,
    removedCount: jobs.length - capped.length,
    companyCount: counts.size,
    largestCompanyCount: Math.max(0, ...counts.values()),
  };
}

export function summarizeCompanyUniverse() {
  const byIndustry = new Map<string, number>();
  const byMarket = new Map<CompanyMarket, number>();

  for (const company of TAIWAN_COMPANY_UNIVERSE) {
    byIndustry.set(
      company.industryGroup,
      (byIndustry.get(company.industryGroup) ?? 0) + 1,
    );
    byMarket.set(company.market, (byMarket.get(company.market) ?? 0) + 1);
  }

  return {
    version: COMPANY_UNIVERSE_VERSION,
    companies: TAIWAN_COMPANY_UNIVERSE.length,
    listedCompanies: TAIWAN_COMPANY_UNIVERSE.filter((company) =>
      ["TWSE", "TPEx"].includes(company.market),
    ).length,
    additionalCompanies: TAIWAN_COMPANY_UNIVERSE.filter(
      (company) => !["TWSE", "TPEx"].includes(company.market),
    ).length,
    industryGroups: Object.fromEntries(byIndustry),
    markets: Object.fromEntries(byMarket),
  };
}

export function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /股份有限公司|有限責任公司|有限公司|公司|集團|控股|corporation|incorporated|inc\.?|limited|ltd\.?|co\.?|group|holdings?/giu,
      "",
    )
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function finiteScore(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
