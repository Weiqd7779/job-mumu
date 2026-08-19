export type SalaryRecord = {
  year: number;
  market: "listed" | "otc";
  companyCode: string;
  companyName: string;
  industry: string;
  medianAnnualSalary: number | null;
  averageAnnualSalary: number | null;
  sourceUrl: string;
};

const sources = [
  {
    market: "listed" as const,
    url: "https://openapi.twse.com.tw/v1/opendata/t187ap46_L_5",
  },
  {
    market: "otc" as const,
    url: "https://www.tpex.org.tw/openapi/v1/t187ap46_O_5",
  },
];

export async function fetchOfficialSalaryData(): Promise<SalaryRecord[]> {
  const results = await Promise.allSettled(
    sources.map(async ({ market, url }) => {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`salary_http_${response.status}`);
      const rows = (await response.json()) as Record<string, unknown>[];
      return rows.map((row) => parseSalaryRow(row, market, url)).filter(Boolean);
    }),
  );

  return results.flatMap((result) =>
    result.status === "fulfilled"
      ? (result.value.filter(Boolean) as SalaryRecord[])
      : [],
  );
}

export function exactCompanySalaryMatches(
  companies: string[],
  salaryRecords: SalaryRecord[],
): SalaryRecord[] {
  const exact = new Set(companies.map(normalizeCompanyName).filter(Boolean));
  return salaryRecords.filter((record) =>
    exact.has(normalizeCompanyName(record.companyName)),
  );
}

function parseSalaryRow(
  row: Record<string, unknown>,
  market: "listed" | "otc",
  sourceUrl: string,
): SalaryRecord | null {
  const companyCode = valueByFragment(row, "公司代號");
  const companyName = valueByFragment(row, "公司名稱");
  const year = numberValue(valueByFragment(row, "報告年度"));
  if (!companyCode || !companyName || !year) return null;

  return {
    year,
    market,
    companyCode,
    companyName,
    industry:
      valueByFragment(row, "產業別") || valueByFragment(row, "產業類別"),
    medianAnnualSalary: numberValue(
      valueByFragment(row, "薪資中位數(仟元/人)"),
    ),
    averageAnnualSalary: numberValue(
      valueByFragment(row, "薪資平均數(仟元/人)"),
    ),
    sourceUrl,
  };
}

function valueByFragment(
  row: Record<string, unknown>,
  fragment: string,
): string {
  const entry = Object.entries(row).find(([key]) =>
    key.replace(/\s+/g, "").includes(fragment.replace(/\s+/g, "")),
  );
  return entry ? String(entry[1] ?? "").trim() : "";
}

function numberValue(value: string): number | null {
  const parsed = Number(value.replace(/[,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（）()]/g, "")
    .toLowerCase();
}
