export type CommunityEvidenceRecord = {
  source: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  firsthand: boolean;
};

export type CommunityEvidenceSummary = {
  count: number;
  sourceCount: number;
  firsthandCount: number;
  thresholdMet: boolean;
};

export type AgentCommunityContext = CommunityEvidenceSummary & {
  evidence: Array<{
    id: string;
    source: string;
    url: string;
    title: string;
    snippet: string;
    publishedAt: string | null;
    firsthand: boolean;
  }>;
};

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
]);

export function normalizeCommunityUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function dedupeCommunityEvidence<T extends CommunityEvidenceRecord>(
  records: T[],
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const record of records) {
    const key = normalizeCommunityUrl(record.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }
  return unique;
}

export function summarizeCommunityEvidence(
  records: CommunityEvidenceRecord[],
): CommunityEvidenceSummary {
  const unique = dedupeCommunityEvidence(records);
  const sourceCount = new Set(
    unique.map((record) => communitySourceKey(record.url, record.source)),
  ).size;
  const firsthandCount = unique.filter((record) => record.firsthand).length;
  return {
    count: unique.length,
    sourceCount,
    firsthandCount,
    thresholdMet:
      unique.length >= 3 && sourceCount >= 2 && firsthandCount >= 1,
  };
}

export function buildAgentCommunityContext(
  records: CommunityEvidenceRecord[],
  limit = 12,
): AgentCommunityContext {
  const unique = dedupeCommunityEvidence(records);
  const summary = summarizeCommunityEvidence(unique);
  const groups = new Map<string, CommunityEvidenceRecord[]>();

  for (const record of unique) {
    const source = communitySourceKey(record.url, record.source);
    const group = groups.get(source) ?? [];
    group.push(record);
    groups.set(source, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => Number(right.firsthand) - Number(left.firsthand));
  }

  const selected: CommunityEvidenceRecord[] = [];
  const boundedLimit = Math.min(Math.max(limit, 0), 20);
  while (selected.length < boundedLimit) {
    let added = false;
    for (const group of groups.values()) {
      const next = group.shift();
      if (!next) continue;
      selected.push(next);
      added = true;
      if (selected.length >= boundedLimit) break;
    }
    if (!added) break;
  }

  return {
    ...summary,
    evidence: selected.map((record, index) => ({
      id: `community-${index + 1}`,
      source: communitySourceKey(record.url, record.source),
      url: record.url,
      title: compactText(record.title, 200),
      snippet: compactText(record.snippet, 600),
      publishedAt: record.publishedAt,
      firsthand: record.firsthand,
    })),
  };
}

export function isFirsthandCommunityResult(title: string, snippet: string): boolean {
  return /(面試|任職|在職|工作經驗|心得|錄取|報到|離職)/i.test(`${title} ${snippet}`);
}

function communitySourceKey(urlValue: string, fallback: string): string {
  try {
    return new URL(urlValue).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return compactText(fallback, 100).toLowerCase() || "unknown";
  }
}

function compactText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
