import { test } from "node:test";
import assert from "node:assert/strict";
import { opportunities } from "../src/opportunities.js";
import { plants } from "../src/seeds.js";
const claim = {
  id: "A",
  statement:
    "The permit describes brewhouse operations and a natural gas boiler.",
  quote: "brewhouse operations and a natural gas boiler",
  source_id: "S",
  version: "v",
  locator: "p1",
  classification: "reported_fact",
  site_match: "exact_identifier",
  temporal_scope: "historical",
};
test("brewery opportunities distinguish sector assumptions from plant process evidence", () => {
  const rows = opportunities(
    plants[2],
    { mode: "codex_assisted_review", claims: [claim] },
    [],
  );
  assert.ok(
    rows.some((r) => r.id === "brewery-cip" && r.basis === "industry-pattern"),
  );
  assert.ok(
    rows.some((r) => r.id === "boiler" && r.basis === "documented-process"),
  );
  assert.ok(rows.every((r) => r.status === "potential—not verified in use"));
  assert.ok(
    rows.every(
      (r) =>
        r.qualification_questions.length &&
        r.disqualifiers.length &&
        r.industry_sources.length,
    ),
  );
});
test("closure hold suppresses all opportunities and demo records do not create live sales claims", () => {
  assert.deepEqual(
    opportunities(
      plants[4],
      { claims: [claim], mode: "codex_assisted_review" },
      [],
    ),
    [],
  );
  assert.deepEqual(
    opportunities(plants[2], { claims: [claim], mode: "synthetic_demo" }, []),
    [],
  );
});
test("rejected/unsupported process claims cannot trigger a process-specific opportunity", () => {
  const p = { mode: "codex_assisted_review", claims: [claim] };
  assert.ok(!opportunities(plants[2], p, ["A"]).some((r) => r.id === "boiler"));
  assert.ok(
    !opportunities(
      plants[2],
      {
        ...p,
        claims: [{ ...claim, classification: "regulatory_boilerplate" }],
      },
      [],
    ).some((r) => r.id === "boiler"),
  );
});

test("Brenntag mapping distinguishes public categories from an unverified add-on product", async () => {
  const { brenntagFit } = await import("../src/opportunities.js");
  assert.equal(brenntagFit("wastewater").status, "Public category match");
  assert.equal(
    brenntagFit("brewery-cip").status,
    "Partial match—base chemistry only",
  );
  assert.equal(
    brenntagFit("dairy-cip").status,
    "Portfolio fit not yet verified",
  );
});
