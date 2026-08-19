export type JobSourceType =
  | "taiwan_jobs"
  | "user_jd"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "recruitee"
  | "workday"
  | "company_careers";

export type NormalizedJob = {
  source: JobSourceType;
  sourceJobId: string | null;
  canonicalUrl: string | null;
  title: string;
  company: string;
  location: string;
  description: string;
  requiredText: string;
  preferredText: string;
  salaryText: string;
  publishedAt: string | null;
  licenseType: string;
  mayStoreOriginal: boolean;
};

export function normalizeJobText(value: string): string {
  return decodeEntities(stripHtml(value))
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function extractRequirementSections(value: string): {
  description: string;
  requiredText: string;
  preferredText: string;
} {
  const text = normalizeJobText(value);
  const required: string[] = [];
  const preferred: string[] = [];
  let mode: "description" | "required" | "preferred" = "description";

  for (const line of text.split("\n").map((item) => item.trim()).filter(Boolean)) {
    if (
      /^(requirements?|qualifications?|what you(?:'|’)ll need|必備|條件要求|任職條件|職缺條件)/i.test(
        line,
      )
    ) {
      mode = "required";
      continue;
    }
    if (
      /^(preferred|nice to have|bonus|加分|尤佳|優先條件|希望條件)/i.test(line)
    ) {
      mode = "preferred";
      continue;
    }
    if (
      /^(responsibilities|what you(?:'|’)ll do|工作內容|職務內容|主要職責|about the role)/i.test(
        line,
      )
    ) {
      mode = "description";
      continue;
    }
    if (mode === "required") required.push(line);
    if (mode === "preferred") preferred.push(line);
  }

  return {
    description: text,
    requiredText: required.join("\n"),
    preferredText: preferred.join("\n"),
  };
}

function stripHtml(value: string): string {
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#\d+|#x[\da-f]+|[a-z]+);/gi,
    (entity, token: string) => {
      if (token.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
      }
      if (token.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
      }
      return named[token.toLowerCase()] ?? entity;
    },
  );
}
