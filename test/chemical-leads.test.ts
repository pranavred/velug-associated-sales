import { test } from "node:test";
import assert from "node:assert/strict";
import { chemicalLeads } from "../src/chemical-leads.js";
const opportunity = {
  id: "boiler",
  plant_id: "P",
  profile_id: 1,
  categories: ["Sulfite-based oxygen scavengers"],
  basis: "documented-process",
  plant_evidence: [{ claim_id: "C", source_id: "S", version: "v" }],
  qualification_questions: ["Question?"],
  why: "Boiler evidence",
  disqualifiers: [],
  roles_to_approach: [],
  industry_sources: [],
};
const profiles = [
  {
    plant: "P",
    id: 1,
    profile: { claims: [{ id: "C", site_match: "exact_identifier" }] },
  },
];
test("estimated-use score explains its sum and does not assert known use", () => {
  const [c] = chemicalLeads([opportunity], profiles, [
    { id: "S", version: "v", url: "https://example.org" },
  ]);
  assert.equal(c.confidence.score, 55);
  assert.equal(
    c.confidence.factors.reduce(
      (n: number, f: { points: number }) => n + f.points,
      0,
    ),
    55,
  );
  assert.equal(c.known_use, false);
  assert.equal(c.relationship, "potential_use");
  assert.equal(c.evidence[0].source_url, "https://example.org");
});
test("changed supporting evidence lowers confidence", () => {
  const [fresh] = chemicalLeads([opportunity], profiles, [
    { id: "S", version: "v" },
  ]);
  const [stale] = chemicalLeads([opportunity], profiles, [
    { id: "S", version: "changed" },
  ]);
  assert.equal(stale.confidence.score, fresh.confidence.score - 15);
});
test("industry-pattern and specialty add-ons rank below documented processes", () => {
  const [c] = chemicalLeads(
    [
      {
        ...opportunity,
        basis: "industry-pattern",
        plant_evidence: [],
        categories: ["Oxygen-based cleaning boosters"],
      },
    ],
    profiles,
    [],
  );
  assert.equal(c.confidence.score, 15);
  assert.equal(c.basis, "Industry-based");
  assert.equal(c.confidence.label, "Exploratory");
});
test("no opportunity produces no invented chemical rows", () =>
  assert.deepEqual(chemicalLeads([], profiles, []), []));
