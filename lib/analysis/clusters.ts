import type { NormalizedJob } from "../data/jobs";
import { matchJobToRole } from "./role-matcher";

export type JobCluster = {
  key: string;
  name: string;
  reason: string;
  representativeTitles: string[];
  jobIndexes: number[];
  included: boolean;
};

export function clusterJobs(
  jobs: NormalizedJob[],
  targetRole = "",
): JobCluster[] {
  if (jobs.length === 1) {
    return [
      {
        key: "single-jd",
        name: "本次單一職缺",
        reason: "單一 JD 直接分析，不以預設職業清單限制。",
        representativeTitles: [jobs[0].title],
        jobIndexes: [0],
        included: true,
      },
    ];
  }

  const groups: JobCluster[] = [
    {
      key: "high",
      name: `${targetRole || "目標職業"}核心職缺`,
      reason: "職稱或主要工作內容與目標職業有高信心對應。",
      representativeTitles: [],
      jobIndexes: [],
      included: true,
    },
    {
      key: "adjacent",
      name: "相鄰／混合職缺",
      reason: "部分職責符合目標職業，可能是全端、跨領域或不同命名。",
      representativeTitles: [],
      jobIndexes: [],
      included: true,
    },
    {
      key: "low",
      name: "低相關職缺",
      reason: "目前證據不足以判定主要工作屬於目標職業。",
      representativeTitles: [],
      jobIndexes: [],
      included: false,
    },
  ];

  jobs.forEach((job, index) => {
    const match = matchJobToRole(targetRole, job);
    const group = match.score >= 75 ? groups[0] : match.score >= 45 ? groups[1] : groups[2];
    group.jobIndexes.push(index);
    if (
      group.representativeTitles.length < 3 &&
      !group.representativeTitles.includes(job.title)
    ) {
      group.representativeTitles.push(job.title);
    }
  });

  return groups
    .filter((group) => group.jobIndexes.length > 0)
    .sort((left, right) => right.jobIndexes.length - left.jobIndexes.length);
}
