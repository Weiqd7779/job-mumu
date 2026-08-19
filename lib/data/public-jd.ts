import type { NormalizedJob } from "./jobs";
import { userJdToJob } from "./taiwan-jobs";

const restrictedHosts = ["104.com.tw", "1111.com.tw", "linkedin.com"];

export async function fetchPublicJd(urlValue: string): Promise<NormalizedJob> {
  let url = validatePublicUrl(urlValue);
  let response: Response | null = null;

  for (let redirect = 0; redirect < 4; redirect += 1) {
    response = await fetch(url, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain",
        "User-Agent": "JobMumu/1.0 (+public JD analysis)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("jd_redirect_without_location");
      url = validatePublicUrl(new URL(location, url).href);
      continue;
    }
    break;
  }

  if (!response?.ok) {
    throw new Error(`jd_http_${response?.status ?? "unknown"}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/") && !contentType.includes("html")) {
    throw new Error("jd_unsupported_content_type");
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > 1_500_000) throw new Error("jd_page_too_large");
  const raw = (await response.text()).slice(0, 1_500_000);
  const title = htmlTitle(raw) || "公開職缺";
  const text = contentType.includes("html") ? htmlToText(raw) : raw.trim();
  if (text.length < 120) throw new Error("jd_content_too_short");

  const job = userJdToJob(text, title);
  return {
    ...job,
    canonicalUrl: url.href,
    source: "user_jd",
    licenseType: "公開頁面；僅供使用者指定職缺分析",
    mayStoreOriginal: false,
  };
}

function validatePublicUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("jd_invalid_protocol");
  }
  if (url.username || url.password) throw new Error("jd_credentials_not_allowed");
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("jd_nonstandard_port");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (restrictedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
    throw new Error("jd_source_requires_user_paste");
  }
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("jd_private_host_not_allowed");
  }
  return url;
}

function htmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(stripTags(match[1])).trim().slice(0, 160) : "";
}

function htmlToText(html: string): string {
  return decodeEntities(
    stripTags(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<(br|p|li|h[1-6]|tr|section|article|div)\b[^>]*>/gi, "\n"),
    ),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}
