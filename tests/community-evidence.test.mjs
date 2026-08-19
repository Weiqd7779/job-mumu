import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentCommunityContext,
  dedupeCommunityEvidence,
  normalizeCommunityUrl,
  summarizeCommunityEvidence,
} from "../lib/analysis/community.ts";

const records = [
  {
    source: "PTT",
    title: "面試心得",
    url: "https://www.ptt.cc/bbs/Tech_Job/M.1.html?utm_source=test#main",
    snippet: "分享我的面試與錄取經驗。",
    publishedAt: "1 month ago",
    firsthand: true,
  },
  {
    source: "PTT",
    title: "重複結果",
    url: "https://ptt.cc/bbs/Tech_Job/M.1.html",
    snippet: "同一篇文章。",
    publishedAt: "1 month ago",
    firsthand: false,
  },
  {
    source: "Dcard",
    title: "工作討論",
    url: "https://www.dcard.tw/f/job/p/1",
    snippet: "工作內容討論。",
    publishedAt: null,
    firsthand: false,
  },
  {
    source: "面試趣",
    title: "面試紀錄",
    url: "https://interview.tw/i/1",
    snippet: "面試流程紀錄。",
    publishedAt: "2 months ago",
    firsthand: true,
  },
];

test("community URLs are normalized and duplicate tracking URLs collapse", () => {
  assert.equal(
    normalizeCommunityUrl(records[0].url),
    "https://ptt.cc/bbs/Tech_Job/M.1.html",
  );
  assert.equal(dedupeCommunityEvidence(records).length, 3);
});

test("community threshold requires three unique posts, two sources, and firsthand evidence", () => {
  assert.deepEqual(summarizeCommunityEvidence(records), {
    count: 3,
    sourceCount: 3,
    firsthandCount: 2,
    thresholdMet: true,
  });

  const oneSource = records.filter((record) => record.url.includes("ptt.cc"));
  assert.equal(summarizeCommunityEvidence(oneSource).thresholdMet, false);
});

test("Agent context is bounded and samples across sources", () => {
  const context = buildAgentCommunityContext(records, 2);
  assert.equal(context.evidence.length, 2);
  assert.equal(new Set(context.evidence.map((item) => item.source)).size, 2);
  assert.equal(context.thresholdMet, true);
});
