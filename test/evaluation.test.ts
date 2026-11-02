import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, diffSegments } from "../src/evaluation.js";
const evidence = [
  {
    source_id: "S1",
    version: "v1",
    url: "https://example.com",
    segments: [{ locator: "p1", text: "A sufficiently long exact excerpt." }],
  },
];
const profile = {
  claims: [
    {
      id: "A",
      source_id: "S1",
      version: "v1",
      locator: "p1",
      quote: "A sufficiently long exact excerpt.",
    },
  ],
};
test("unreviewed semantics remain unknown despite exact quotes", () => {
  const r = evaluate(profile, evidence, []);
  assert.equal(r.traceable_claims, 1);
  assert.equal(r.support_precision, null);
  assert.equal(r.wrong_site_count, null);
  assert.equal(r.review_complete, false);
});
test("review can map one claim to multiple reference items without double counting", () => {
  const r = evaluate(profile, evidence, [
    {
      claim_id: "A",
      supported: true,
      wrong_site: false,
      unsupported_chemical_assertion: false,
      reference_ids: ["C03", "C04", "C03"],
    },
  ]);
  assert.equal(r.reference_coverage.covered.length, 2);
  assert.equal(r.support_precision, 1);
  assert.equal(r.review_complete, true);
});
test("reject stale claim annotations and source-version mismatch", () => {
  assert.throws(
    () =>
      evaluate(profile, evidence, [
        {
          claim_id: "unknown",
          supported: true,
          wrong_site: false,
          unsupported_chemical_assertion: false,
          reference_ids: [],
        },
      ]),
    /missing/,
  );
  assert.equal(
    evaluate(profile, [{ ...evidence[0], version: "v2" }], []).traceable_claims,
    0,
  );
});
test("diff distinguishes new, removed and changed segments; unchanged text is silent", () => {
  assert.deepEqual(
    diffSegments(
      [{ locator: "1", text: "same" }],
      [{ locator: "1", text: "same" }],
    ),
    [],
  );
  const r = diffSegments(
    [
      { locator: "1", text: "old" },
      { locator: "2", text: "gone" },
    ],
    [
      { locator: "1", text: "new" },
      { locator: "3", text: "added" },
    ],
  );
  assert.deepEqual(
    r.map((v) => v.kind),
    ["changed", "removed", "added"],
  );
});
