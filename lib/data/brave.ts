import { requireRuntimeEnv } from "../runtime-env";

export type BraveResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt: string | null;
};

type BraveResponse = {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      age?: string;
      profile?: { long_name?: string };
    }>;
  };
};

const API_URL = "https://api.search.brave.com/res/v1/web/search";

export async function braveForumSearch(
  query: string,
  count = 10,
): Promise<BraveResult[]> {
  assertNoPii(query);
  const token = requireRuntimeEnv("BRAVE_SEARCH_API_KEY");
  const url = new URL(API_URL);
  url.searchParams.set("q", query.slice(0, 400));
  url.searchParams.set("country", "TW");
  url.searchParams.set("search_lang", "zh-hant");
  url.searchParams.set("ui_lang", "zh-TW");
  url.searchParams.set("count", String(Math.min(Math.max(count, 1), 20)));
  url.searchParams.set("safesearch", "strict");
  url.searchParams.set("extra_snippets", "true");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": token,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`brave_http_${response.status}`);
  const body = (await response.json()) as BraveResponse;
  return (body.web?.results ?? [])
    .filter((item) => item.url && item.title)
    .map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: item.description ?? "",
      source:
        item.profile?.long_name ??
        safeHostname(item.url ?? "") ??
        "公開網頁",
      publishedAt: item.age ?? null,
    }));
}

export function buildForumQueries(targetRole: string): string[] {
  const role = targetRole.replace(/[^\p{L}\p{N}+#.\s-]/gu, " ").trim();
  return [
    `"${role}" 面試 經驗 site:ptt.cc`,
    `"${role}" 工作 經驗 site:dcard.tw`,
    `"${role}" 面試 site:interview.tw OR site:salary.tw`,
  ];
}

function assertNoPii(query: string): void {
  const email = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;
  const taiwanPhone = /(?:\+?886[-\s]?)?0?9\d{2}[-\s]?\d{3}[-\s]?\d{3}/;
  if (email.test(query) || taiwanPhone.test(query)) {
    throw new Error("brave_query_contains_pii");
  }
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
