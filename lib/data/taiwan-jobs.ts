import { matchJobToRole } from "../analysis/role-matcher";
import type { NormalizedJob } from "./jobs";

export type { NormalizedJob } from "./jobs";

type MolResponse = {
  success?: boolean;
  updateTime?: string;
  result?: { records?: Record<string, unknown>[] };
};

const ENDPOINT =
  "https://apiservice.mol.gov.tw/OdService/rest/datastore/A17000000J-030144-VAL";

const fields = {
  occupation: "OCCU_DESC（職務名稱）",
  category: "CJOB_NAME2（職務小類別名稱）",
  detail: "JOB_DETAIL（工作內容）",
  location: "CITYNAME（工作地點）",
  experience: "EXPERIENCE（工作經驗）",
  education: "EDGRDESC（最低學歷要求）",
  schedule: "WKTIME（工作時間）",
  salaryType: "SALARYCD（核薪方式）",
  lower: "NT_L（薪資範圍下限）",
  upper: "NT_U（薪資範圍上限）",
  url: "URL_QUERY（職缺資料URL）",
  company: "COMPNAME（公司名稱）",
  updated: "TRANDATE（職缺更新日期）",
  code: "CJOB2_COUNT（職務小類別代碼）",
} as const;

export async function searchTaiwanJobs(
  targetRole: string,
  options: { maxPages?: number; maxResults?: number } = {},
): Promise<{ jobs: NormalizedJob[]; updateTime: string | null; scanned: number }> {
  const maxPages = Math.min(Math.max(options.maxPages ?? 5, 1), 10);
  const maxResults = Math.min(Math.max(options.maxResults ?? 160, 1), 300);
  const jobs: NormalizedJob[] = [];
  let scanned = 0;
  let updateTime: string | null = null;

  for (let page = 0; page < maxPages && jobs.length < maxResults; page += 1) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(page * 1000));
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`taiwan_jobs_http_${response.status}`);
    }
    const body = (await response.json()) as MolResponse;
    if (!body.success) throw new Error("taiwan_jobs_invalid_response");
    const records = body.result?.records ?? [];
    updateTime = body.updateTime ?? updateTime;
    scanned += records.length;

    for (const record of records) {
      const title =
        stringField(record, fields.occupation) ||
        stringField(record, fields.category);
      const detail = stringField(record, fields.detail);
      const company = stringField(record, fields.company);
      if (
        !matchJobToRole(targetRole, {
          title,
          description: detail,
          requiredText: "",
          preferredText: "",
        }).matched
      ) {
        continue;
      }

      const experience = stringField(record, fields.experience);
      const education = stringField(record, fields.education);
      const lower = stringField(record, fields.lower);
      const upper = stringField(record, fields.upper);
      const salaryType = stringField(record, fields.salaryType);
      jobs.push({
        source: "taiwan_jobs",
        sourceJobId: stringField(record, fields.code) || null,
        canonicalUrl: stringField(record, fields.url) || null,
        title: title || "未標示職稱",
        company,
        location: stringField(record, fields.location),
        description: detail,
        requiredText: [experience && `經驗：${experience}`, education && `學歷：${education}`]
          .filter(Boolean)
          .join("\n"),
        preferredText: "",
        salaryText: [salaryType, lower, upper].filter(Boolean).join(" "),
        publishedAt: normalizeRocDate(stringField(record, fields.updated)),
        licenseType: "政府資料開放授權條款第1版",
        mayStoreOriginal: true,
      });
      if (jobs.length >= maxResults) break;
    }
    if (records.length < 1000) break;
  }

  return { jobs, updateTime, scanned };
}

export function userJdToJob(
  text: string,
  title = "使用者提供的單一 JD",
): NormalizedJob {
  return {
    source: "user_jd",
    sourceJobId: null,
    canonicalUrl: null,
    title,
    company: "",
    location: "",
    description: text.trim(),
    requiredText: "",
    preferredText: "",
    salaryText: "",
    publishedAt: null,
    licenseType: "使用者依法提供",
    mayStoreOriginal: true,
  };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return value == null ? "" : String(value).trim();
}

function normalizeRocDate(value: string): string | null {
  if (!/^\d{8}$/.test(value)) return value || null;
  const year = Number(value.slice(0, 4));
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  return `${year}-${month}-${day}`;
}
