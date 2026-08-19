import assert from "node:assert/strict";
import { build } from "esbuild";
import test from "node:test";

async function importBundled(entryPoint, loader = {}) {
  const result = await build({
    entryPoints: [entryPoint],
    absWorkingDir: process.cwd(),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    loader,
  });
  const source = result.outputFiles[0].text;
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
}

const [roles, stats, companyUniverse, skillRuntime] = await Promise.all([
  importBundled("lib/analysis/role-matcher.ts"),
  importBundled("lib/analysis/keyword-stats.ts"),
  importBundled("lib/data/company-universe.ts"),
  importBundled("lib/skills/career-analysis.ts", { ".md": "text" }),
]);

function job(overrides) {
  return {
    source: "user_jd",
    sourceJobId: null,
    canonicalUrl: null,
    title: "",
    company: "",
    location: "Taipei, Taiwan",
    description: "",
    requiredText: "",
    preferredText: "",
    salaryText: "",
    publishedAt: null,
    licenseType: "test",
    mayStoreOriginal: true,
    ...overrides,
  };
}

test("role matcher handles frontend, firmware, and an unrelated role independently", () => {
  const frontend = job({
    title: "Software Engineer - Web UI",
    description:
      "Build browser applications and reusable interfaces with React and TypeScript.",
  });
  const designer = job({
    title: "UI/UX Designer",
    description: "Create Figma prototypes and visual design specifications.",
  });
  const firmware = job({
    title: "GPU Firmware Engineer",
    description: "Develop embedded C++ firmware, MCU drivers and RTOS features.",
  });
  const marketing = job({
    title: "Growth Marketing Specialist",
    description: "Own campaigns, SEO and marketing analytics.",
  });

  assert.equal(roles.matchJobToRole("前端工程師", frontend).matched, true);
  assert.equal(roles.matchJobToRole("前端工程師", designer).matched, false);
  assert.equal(roles.matchJobToRole("前端工程師", firmware).matched, false);
  assert.equal(roles.matchJobToRole("韌體工程師", firmware).matched, true);
  assert.equal(roles.matchJobToRole("韌體工程師", frontend).matched, false);
  assert.equal(roles.matchJobToRole("行銷企劃", marketing).matched, true);
});

test("skill statistics work for two different engineering occupations", () => {
  const frontendStats = stats.calculateSkillStats([
    job({
      company: "甲公司",
      title: "Frontend Engineer",
      requiredText: "React, TypeScript, HTML and CSS are required.",
    }),
    job({
      company: "乙公司",
      title: "Web UI Engineer",
      description: "Build Vue applications with JavaScript.",
    }),
  ]);
  const firmwareStats = stats.calculateSkillStats([
    job({
      company: "丙公司",
      title: "Firmware Engineer",
      requiredText: "C++ and RTOS development on STM32 MCU.",
    }),
    job({
      company: "丁公司",
      title: "Embedded Software Engineer",
      description: "Embedded Linux, C language, JTAG and hardware debugging.",
    }),
  ]);

  assert.ok(frontendStats.some((item) => item.name === "React"));
  assert.ok(frontendStats.some((item) => item.name === "TypeScript"));
  assert.ok(firmwareStats.some((item) => item.name === "C／C++"));
  assert.ok(firmwareStats.some((item) => item.name === "RTOS"));
  assert.equal(
    frontendStats.find((item) => item.name === "React")?.companyTotal,
    2,
  );
  assert.equal(
    firmwareStats.find((item) => item.name === "C／C++")?.companyTotal,
    2,
  );
});

test("company cap is deterministic and keeps the highest-ranked five jobs", () => {
  const jobs = Array.from({ length: 7 }, (_, index) => ({
    company: "測試股份有限公司",
    score: index,
  }));
  const result = companyUniverse.applyCompanyJobCap(
    jobs,
    5,
    (item) => item.score,
  );
  assert.equal(result.afterCount, 5);
  assert.equal(result.removedCount, 2);
  assert.deepEqual(
    result.jobs.map((item) => item.score),
    [6, 5, 4, 3, 2],
  );
});

test("runtime agent imports the actual career-analysis skill and schema", () => {
  assert.equal(skillRuntime.CAREER_ANALYSIS_SKILL_NAME, "career-analysis");
  assert.equal(skillRuntime.CAREER_ANALYSIS_SKILL_VERSION, "1.1.1");
  assert.match(skillRuntime.CAREER_ANALYSIS_SYSTEM_PROMPT, /Evidence policy/);
  assert.match(
    skillRuntime.CAREER_ANALYSIS_SYSTEM_PROMPT,
    /Community evidence policy/,
  );
  assert.deepEqual(
    skillRuntime.CAREER_ANALYSIS_OUTPUT_SCHEMA.required,
    [
      "summary",
      "facts",
      "inferences",
      "community_signals",
      "recommendations",
      "limitations",
      "citations",
      "confidence",
      "skill_version",
      "model_id",
    ],
  );
});
