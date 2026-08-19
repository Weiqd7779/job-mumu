import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const universe = JSON.parse(
  await readFile(
    new URL("../lib/data/taiwan-company-universe.json", import.meta.url),
    "utf8",
  ),
);

test("company universe is fixed, unique, and company-capped", () => {
  assert.equal(universe.version, "2026-07-31-v2");
  assert.equal(universe.companyCap, 5);
  assert.equal(universe.companies.length, 30);
  assert.equal(
    new Set(universe.companies.map((company) => company.id)).size,
    universe.companies.length,
  );
});

test("company universe has the intended listed and industry coverage", () => {
  const listed = universe.companies.filter((company) =>
    ["TWSE", "TPEx"].includes(company.market),
  );
  assert.equal(listed.length, 20);
  assert.equal(
    new Set(listed.map((company) => company.stockCode)).size,
    listed.length,
  );

  const groups = Map.groupBy(
    universe.companies,
    (company) => company.industryGroup,
  );
  assert.equal(groups.size, 6);
  assert.equal(groups.get("半導體／IC 設計")?.length, 10);
  for (const companies of groups.values()) {
    assert.ok(companies.length >= 2);
  }
});

test("company universe includes core Taiwan employers and enabled ATS sources", () => {
  const ids = new Set(universe.companies.map((company) => company.id));
  for (const id of [
    "twse-2330",
    "twse-2303",
    "twse-2454",
    "twse-2379",
    "twse-3034",
    "tpex-8299",
    "private-binance",
    "private-proton",
    "overseas-appier",
    "foreign-ubiquiti-taiwan",
    "foreign-nvidia-taiwan",
    "foreign-micron-taiwan",
    "overseas-trend-micro",
  ]) {
    assert.ok(ids.has(id), `missing required company ${id}`);
  }

  const sources = universe.companies.flatMap(
    (company) => company.careerSources ?? [],
  );
  assert.equal(sources.filter((source) => source.enabled).length, 7);
  assert.deepEqual(
    new Set(sources.map((source) => source.provider)),
    new Set(["greenhouse", "lever", "workday"]),
  );
});
