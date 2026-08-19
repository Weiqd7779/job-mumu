import {
  TAIWAN_COMPANY_UNIVERSE,
  type CareerSourceConfig,
  type CompanyUniverseEntry,
} from "./company-universe";
import {
  extractRequirementSections,
  normalizeJobText,
  type JobSourceType,
  type NormalizedJob,
} from "./jobs";
import {
  buildRoleSearchQueries,
  matchJobToRole,
} from "../analysis/role-matcher";

export type AtsSourceResult = {
  sourceId: string;
  companyId: string;
  company: string;
  provider: string;
  status: "complete" | "empty" | "error";
  scanned: number;
  taiwanEligible: number;
  matched: number;
  error?: string;
};

export async function collectAtsMarketJobs(targetRole: string): Promise<{
  jobs: NormalizedJob[];
  sources: AtsSourceResult[];
}> {
  const configured = TAIWAN_COMPANY_UNIVERSE.flatMap((company) =>
    company.careerSources
      .filter((source) => source.enabled)
      .map((source) => ({ company, source })),
  );
  const settled = await Promise.all(
    configured.map(({ company, source }) =>
      collectSource(company, source, targetRole),
    ),
  );
  return {
    jobs: dedupeJobs(settled.flatMap((result) => result.jobs)),
    sources: settled.map((result) => result.summary),
  };
}

async function collectSource(
  company: CompanyUniverseEntry,
  source: CareerSourceConfig,
  targetRole: string,
): Promise<{ jobs: NormalizedJob[]; summary: AtsSourceResult }> {
  try {
    const rawJobs = await listSourceJobs(company, source, targetRole);
    const taiwanJobs = rawJobs.filter((job) =>
      isTaiwanEligible(job.location, job.canonicalUrl),
    );
    const jobs = taiwanJobs.filter(
      (job) => matchJobToRole(targetRole, job).matched,
    );
    return {
      jobs,
      summary: {
        sourceId: source.id,
        companyId: company.id,
        company: company.nameZh || company.displayName,
        provider: source.provider,
        status: rawJobs.length ? "complete" : "empty",
        scanned: rawJobs.length,
        taiwanEligible: taiwanJobs.length,
        matched: jobs.length,
      },
    };
  } catch (error) {
    return {
      jobs: [],
      summary: {
        sourceId: source.id,
        companyId: company.id,
        company: company.nameZh || company.displayName,
        provider: source.provider,
        status: "error",
        scanned: 0,
        taiwanEligible: 0,
        matched: 0,
        error: safeSourceError(error),
      },
    };
  }
}

async function listSourceJobs(
  company: CompanyUniverseEntry,
  source: CareerSourceConfig,
  targetRole: string,
): Promise<NormalizedJob[]> {
  if (source.provider === "greenhouse") {
    return listGreenhouse(company, source);
  }
  if (source.provider === "lever") {
    return listLever(company, source);
  }
  if (source.provider === "ashby") {
    return listAshby(company, source);
  }
  if (source.provider === "recruitee") {
    return listRecruitee(company, source);
  }
  if (source.provider === "workday") {
    return listWorkday(company, source, targetRole);
  }
  throw new Error(`unsupported_provider_${source.provider}`);
}

async function listGreenhouse(
  company: CompanyUniverseEntry,
  source: CareerSourceConfig,
): Promise<NormalizedJob[]> {
  if (!source.boardToken) throw new Error("greenhouse_board_token_missing");
  const url =
    source.endpoint ??
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.boardToken)}/jobs?content=true`;
  const body = await fetchJson<{
    jobs?: Array<{
      id?: string | number;
      title?: string;
      updated_at?: string;
      absolute_url?: string;
      content?: string;
      location?: { name?: string };
      offices?: Array<{ location?: string; name?: string }>;
    }>;
  }>(url);
  return (body.jobs ?? []).map((item) => {
    const sections = extractRequirementSections(item.content ?? "");
    return makeJob({
      source: "greenhouse",
      sourceJobId: stringValue(item.id),
      canonicalUrl: item.absolute_url ?? null,
      title: item.title ?? "未標示職稱",
      company,
      location:
        item.location?.name ??
        item.offices?.map((office) => office.location ?? office.name).join(", ") ??
        "",
      ...sections,
      publishedAt: normalizeDate(item.updated_at),
    });
  });
}

async function listLever(
  company: CompanyUniverseEntry,
  source: CareerSourceConfig,
): Promise<NormalizedJob[]> {
  if (!source.boardToken) throw new Error("lever_board_token_missing");
  const url =
    source.endpoint ??
    `https://api.lever.co/v0/postings/${encodeURIComponent(source.boardToken)}?mode=json`;
  const body = await fetchJson<
    Array<{
      id?: string;
      text?: string;
      hostedUrl?: string;
      applyUrl?: string;
      createdAt?: number;
      descriptionPlain?: string;
      additionalPlain?: string;
      categories?: {
        location?: string;
        allLocations?: string[];
      };
      lists?: Array<{ text?: string; content?: string }>;
    }>
  >(url);
  return body.map((item) => {
    const description = [
      item.descriptionPlain,
      ...(item.lists ?? []).map(
        (list) => `${list.text ?? ""}\n${normalizeJobText(list.content ?? "")}`,
      ),
      item.additionalPlain,
    ]
      .filter(Boolean)
      .join("\n");
    const sections = extractRequirementSections(description);
    return makeJob({
      source: "lever",
      sourceJobId: item.id ?? null,
      canonicalUrl: item.hostedUrl ?? item.applyUrl ?? null,
      title: item.text ?? "未標示職稱",
      company,
      location:
        item.categories?.allLocations?.join(", ") ??
        item.categories?.location ??
        "",
      ...sections,
      publishedAt: item.createdAt
        ? new Date(item.createdAt).toISOString()
        : null,
    });
  });
}

async function listAshby(
  company: CompanyUniverseEntry,
  source: CareerSourceConfig,
): Promise<NormalizedJob[]> {
  if (!source.boardToken) throw new Error("ashby_board_token_missing");
  const url =
    source.endpoint ??
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.boardToken)}?includeCompensation=true`;
  const body = await fetchJson<{
    jobs?: Array<{
      id?: string;
      title?: string;
      location?: string;
      secondaryLocations?: Array<{ location?: string }>;
      descriptionHtml?: string;
      descriptionPlain?: string;
      jobUrl?: string;
      applyUrl?: string;
      publishedAt?: string;
      compensation?: { compensationTierSummary?: string };
    }>;
  }>(url);
  return (body.jobs ?? []).map((item) => {
    const sections = extractRequirementSections(
      item.descriptionPlain ?? item.descriptionHtml ?? "",
    );
    return makeJob({
      source: "ashby",
      sourceJobId: item.id ?? null,
      canonicalUrl: item.jobUrl ?? item.applyUrl ?? null,
      title: item.title ?? "未標示職稱",
      company,
      location: [
        item.location,
        ...(item.secondaryLocations ?? []).map((location) => location.location),
      ]
        .filter(Boolean)
        .join(", "),
      ...sections,
      salaryText: item.compensation?.compensationTierSummary ?? "",
      publishedAt: normalizeDate(item.publishedAt),
    });
  });
}

async function listRecruitee(
  company: CompanyUniverseEntry,
  source: CareerSourceConfig,
): Promise<NormalizedJob[]> {
  if (!source.boardToken) throw new Error("recruitee_board_token_missing");
  const url =
    source.endpoint ??
    `https://${encodeURIComponent(source.boardToken)}.recruitee.com/api/offers/`;
  const body = await fetchJson<{
    offers?: Array<Record<string, unknown>>;
  }>(url);
  return (body.offers ?? []).map((item) => {
    const description = [
      item.description,
      item.requirements,
      item.additional_information,
    ]
      .filter(Boolean)
      .map(String)
      .join("\n");
    const sections = extractRequirementSections(description);
    return makeJob({
      source: "recruitee",
      sourceJobId: stringValue(item.id),
      canonicalUrl:
        stringValue(item.careers_url) ?? stringValue(item.url) ?? null,
      title: stringValue(item.title) ?? "未標示職稱",
      company,
      location: [
        item.location,
        item.city,
        item.country,
        item.remote ? "Remote" : "",
      ]
        .filter(Boolean)
        .map(String)
        .join(", "),
      ...sections,
      publishedAt:
        normalizeDate(stringValue(item.published_at)) ??
        normalizeDate(stringValue(item.created_at)),
    });
  });
}

async function listWorkday(
  company: CompanyUniverseEntry,
  source: CareerSourceConfig,
  targetRole: string,
): Promise<NormalizedJob[]> {
  if (!source.endpoint) throw new Error("workday_endpoint_missing");
  const paths = new Map<string, WorkdayListItem>();
  for (const searchText of buildRoleSearchQueries(targetRole)) {
    const body = await fetchJson<{
      jobPostings?: WorkdayListItem[];
    }>(`${source.endpoint}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appliedFacets: {},
        limit: 20,
        offset: 0,
        searchText,
      }),
    });
    for (const item of body.jobPostings ?? []) {
      if (!item.externalPath) continue;
      if (
        isTaiwanEligible(
          `${item.locationsText ?? ""} ${item.externalPath}`,
          item.externalPath,
        ) ||
        /\d+\s+Locations?/i.test(item.locationsText ?? "")
      ) {
        paths.set(item.externalPath, item);
      }
    }
  }

  const details = await mapWithConcurrency(
    [...paths.entries()].slice(0, 24),
    6,
    async ([externalPath]) =>
      fetchJson<{
        jobPostingInfo?: {
          id?: string;
          title?: string;
          jobDescription?: string;
          location?: string;
          postedOn?: string;
          startDate?: string;
          jobReqId?: string;
          externalUrl?: string;
          canApply?: boolean;
        };
      }>(`${source.endpoint}${externalPath}`),
  );

  return details.flatMap((body) => {
    const item = body.jobPostingInfo;
    if (!item || item.canApply === false) return [];
    const sections = extractRequirementSections(item.jobDescription ?? "");
    return [
      makeJob({
        source: "workday",
        sourceJobId: item.jobReqId ?? item.id ?? null,
        canonicalUrl: item.externalUrl ?? null,
        title: item.title ?? "未標示職稱",
        company,
        location: item.location ?? "",
        ...sections,
        publishedAt: normalizeDate(item.startDate),
      }),
    ];
  });
}

function makeJob(input: {
  source: JobSourceType;
  sourceJobId: string | null;
  canonicalUrl: string | null;
  title: string;
  company: CompanyUniverseEntry;
  location: string;
  description: string;
  requiredText: string;
  preferredText: string;
  salaryText?: string;
  publishedAt: string | null;
}): NormalizedJob {
  return {
    source: input.source,
    sourceJobId: input.sourceJobId,
    canonicalUrl: input.canonicalUrl,
    title: normalizeJobText(input.title) || "未標示職稱",
    company: input.company.nameZh || input.company.displayName,
    location: normalizeJobText(input.location),
    description: input.description,
    requiredText: input.requiredText,
    preferredText: input.preferredText,
    salaryText: input.salaryText ?? "",
    publishedAt: input.publishedAt,
    licenseType: `${input.source} 公開職缺資料；僅供本次分析與來源連結`,
    mayStoreOriginal: false,
  };
}

function isTaiwanEligible(location: string, url: string | null): boolean {
  const value = `${location} ${url ?? ""}`;
  return /(taiwan|taipei|new taipei|hsinchu|taichung|tainan|kaohsiung|台灣|臺灣|台北|臺北|新北|新竹|台中|臺中|台南|臺南|高雄)/i.test(
    value,
  );
}

function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = job.canonicalUrl
      ? job.canonicalUrl.toLowerCase().replace(/[?#].*$/, "")
      : `${job.source}|${job.sourceJobId ?? ""}|${job.company}|${job.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return (await response.json()) as T;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => run()),
  );
  return results;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function stringValue(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function safeSourceError(error: unknown): string {
  return (error instanceof Error ? error.message : "source_error")
    .replace(/https?:\/\/\S+/g, "[URL]")
    .slice(0, 160);
}

type WorkdayListItem = {
  title?: string;
  externalPath?: string;
  locationsText?: string;
};
