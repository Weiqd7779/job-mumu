import { collectAtsMarketJobs, type AtsSourceResult } from "./ats";
import {
  findCompanyUniverseEntry,
  normalizeCompanyName,
  TAIWAN_COMPANY_UNIVERSE,
} from "./company-universe";
import type { NormalizedJob } from "./jobs";
import { searchTaiwanJobs } from "./taiwan-jobs";

export type MarketCollectionResult = {
  jobs: NormalizedJob[];
  scanned: number;
  updateTime: string | null;
  sourceSummary: {
    taiwan_jobs: {
      status: "complete" | "error";
      scanned: number;
      matchedRole: number;
      matchedUniverse: number;
      updateTime: string | null;
      error?: string;
    };
    ats: {
      status: "complete" | "partial" | "error";
      configuredSources: number;
      successfulSources: number;
      failedSources: number;
      scanned: number;
      taiwanEligible: number;
      matchedRole: number;
      providers: Record<string, number>;
      sources: AtsSourceResult[];
    };
    company_universe: {
      count: number;
      directConfiguredCompanies: number;
      fallbackOnlyCompanies: number;
      matchedCompanies: number;
      zeroMatchedCompanies: number;
    };
  };
};

export async function collectMarketJobs(
  targetRole: string,
): Promise<MarketCollectionResult> {
  const [ats, taiwan] = await Promise.all([
    collectAtsMarketJobs(targetRole),
    searchTaiwanJobs(targetRole, { maxPages: 5, maxResults: 240 })
      .then((result) => ({ result, error: null as string | null }))
      .catch((error) => ({
        result: { jobs: [], scanned: 0, updateTime: null },
        error: safeError(error),
      })),
  ]);

  const taiwanUniverseJobs = taiwan.result.jobs.flatMap((job) => {
    const company = findCompanyUniverseEntry(job.company);
    if (!company) return [];
    return [{ ...job, company: company.nameZh || company.displayName }];
  });
  const jobs = dedupeAcrossSources([...ats.jobs, ...taiwanUniverseJobs]);
  const matchedCompanies = new Set(
    jobs
      .map((job) => findCompanyUniverseEntry(job.company)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const directConfiguredCompanies = new Set(
    ats.sources.map((source) => source.companyId),
  ).size;
  const failedSources = ats.sources.filter(
    (source) => source.status === "error",
  ).length;
  const providers = Object.fromEntries(
    [...new Set(ats.sources.map((source) => source.provider))].map(
      (provider) => [
        provider,
        ats.sources
          .filter((source) => source.provider === provider)
          .reduce((sum, source) => sum + source.matched, 0),
      ],
    ),
  );

  return {
    jobs,
    scanned:
      taiwan.result.scanned +
      ats.sources.reduce((sum, source) => sum + source.scanned, 0),
    updateTime: taiwan.result.updateTime,
    sourceSummary: {
      taiwan_jobs: {
        status: taiwan.error ? "error" : "complete",
        scanned: taiwan.result.scanned,
        matchedRole: taiwan.result.jobs.length,
        matchedUniverse: taiwanUniverseJobs.length,
        updateTime: taiwan.result.updateTime,
        ...(taiwan.error ? { error: taiwan.error } : {}),
      },
      ats: {
        status:
          ats.sources.length === 0 || failedSources === ats.sources.length
            ? "error"
            : failedSources
              ? "partial"
              : "complete",
        configuredSources: ats.sources.length,
        successfulSources: ats.sources.length - failedSources,
        failedSources,
        scanned: ats.sources.reduce(
          (sum, source) => sum + source.scanned,
          0,
        ),
        taiwanEligible: ats.sources.reduce(
          (sum, source) => sum + source.taiwanEligible,
          0,
        ),
        matchedRole: ats.sources.reduce(
          (sum, source) => sum + source.matched,
          0,
        ),
        providers,
        sources: ats.sources,
      },
      company_universe: {
        count: TAIWAN_COMPANY_UNIVERSE.length,
        directConfiguredCompanies,
        fallbackOnlyCompanies:
          TAIWAN_COMPANY_UNIVERSE.length - directConfiguredCompanies,
        matchedCompanies: matchedCompanies.size,
        zeroMatchedCompanies:
          TAIWAN_COMPANY_UNIVERSE.length - matchedCompanies.size,
      },
    },
  };
}

function dedupeAcrossSources(jobs: NormalizedJob[]): NormalizedJob[] {
  const sorted = [...jobs].sort(
    (left, right) => sourcePriority(right.source) - sourcePriority(left.source),
  );
  const seen = new Set<string>();
  return sorted.filter((job) => {
    const company = normalizeCompanyName(job.company);
    const title = normalizeText(job.title);
    const location = normalizeText(job.location);
    const key = `${company}|${title}|${location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourcePriority(source: NormalizedJob["source"]): number {
  if (source === "taiwan_jobs") return 1;
  if (source === "user_jd") return 3;
  return 2;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "source_error").slice(0, 160);
}
