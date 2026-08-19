export type InputIntent = {
  type: "market" | "single_jd_url" | "single_jd_text";
  targetRole: string;
  resumeRequested: boolean;
  needsConfirmation: boolean;
  sourceHost?: string;
  warnings: string[];
};

const resumePattern = /(履歷|resume|cv|求職信|自傳)/i;
const jdPattern =
  /(工作內容|職務內容|職缺條件|條件要求|requirements?|responsibilities|職務說明|加分條件)/i;

export function classifyInput(rawInput: string): InputIntent {
  const input = rawInput.trim();
  const resumeRequested = resumePattern.test(input);
  const url = firstHttpUrl(input);

  if (url) {
    return {
      type: "single_jd_url",
      targetRole: inferRole(input.replace(url.href, "")) || "單一職缺",
      resumeRequested,
      needsConfirmation: true,
      sourceHost: url.hostname.toLowerCase(),
      warnings: restrictedHostWarning(url.hostname),
    };
  }

  if (input.length >= 280 || jdPattern.test(input)) {
    return {
      type: "single_jd_text",
      targetRole: inferRole(input) || "單一職缺",
      resumeRequested,
      needsConfirmation: resumeRequested,
      warnings: [],
    };
  }

  return {
    type: "market",
    targetRole: inferRole(input) || input,
    resumeRequested,
    needsConfirmation: true,
    warnings: [],
  };
}

function firstHttpUrl(input: string): URL | null {
  const match = input.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  try {
    return new URL(match[0]);
  } catch {
    return null;
  }
}

function inferRole(input: string): string {
  const cleaned = input
    .replace(resumePattern, "")
    .replace(/(幫我|請|針對|分析|撰寫|製作|市場|台灣|職缺|這份|一份)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const firstLine = cleaned.split(/\n|。|，/)[0]?.trim() ?? "";
  return firstLine.slice(0, 80);
}

function restrictedHostWarning(host: string): string[] {
  const normalized = host.replace(/^www\./, "");
  if (
    normalized.endsWith("104.com.tw") ||
    normalized.endsWith("1111.com.tw") ||
    normalized.endsWith("linkedin.com")
  ) {
    return [
      "此來源可能限制自動讀取；若無法取得完整 JD，系統會要求貼上文字或上傳檔案。",
    ];
  }
  return [];
}
