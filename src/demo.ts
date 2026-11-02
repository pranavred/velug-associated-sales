import { Store, type Segment } from "./store.js";
import { saveVersion } from "./collect.js";
import { plants } from "./seeds.js";
import { validateProfile, evidenceFor, fingerprint } from "./agents.js";
export function demo(store: Store) {
  store.seed();
  for (const p of plants) {
    const source = store.get(
      "SELECT * FROM sources WHERE plant=? ORDER BY id LIMIT 1",
      p.id,
    );
    const v1: Segment[] = [
      {
        locator: "Synthetic fixture paragraph 1",
        text: `SYNTHETIC DEMO ONLY. ${p.identity[0]}: A fictional facility report lists a process-water system. This is invented test data, not a real source.`,
      },
    ];
    saveVersion(
      store,
      source,
      v1,
      Buffer.from(JSON.stringify(v1)),
      "demo://fixture/v1",
    );
    saveVersion(
      store,
      source,
      v1,
      Buffer.from(JSON.stringify(v1)),
      "demo://fixture/v1",
    );
    const v2 = [
      ...v1,
      {
        locator: "Synthetic fixture paragraph 2",
        text: `SYNTHETIC DEMO ONLY. ${p.identity[0]}: A fictional notice announces a process-water upgrade. It does not establish completed construction.`,
      },
    ];
    saveVersion(
      store,
      source,
      v2,
      Buffer.from(JSON.stringify(v2)),
      "demo://fixture/v2",
    );
    const evidence = evidenceFor(store, p.id);
    const profile = validateProfile(
      {
        claims: [
          {
            id: "D1",
            statement: "Synthetic example: process-water system reported",
            source_id: source.id,
            locator: v1[0].locator,
            quote: v1[0].text,
            site_match: "exact_identifier",
            classification: "reported_fact",
            temporal_scope: "Synthetic fixture; no real event date",
          },
          {
            id: "D2",
            statement: "Synthetic example: upgrade announced",
            source_id: source.id,
            locator: v2[1].locator,
            quote: v2[1].text,
            site_match: "exact_identifier",
            classification: "announcement",
            temporal_scope: "Synthetic fixture; completion unknown",
          },
        ],
        hypotheses: [
          {
            question:
              "Demo: would a process-water upgrade change treatment requirements?",
            claim_ids: ["D2"],
            missing_evidence: [
              "Actual upgrade scope",
              "Operating status",
              "Treatment specifications",
            ],
          },
        ],
        unknowns: [
          "All fixture content is fictional; no buying intent established",
        ],
      },
      evidence,
      p,
    );
    store.run(
      "INSERT OR IGNORE INTO profiles(plant,at,fingerprint,json) VALUES (?,?,?,?)",
      p.id,
      new Date().toISOString(),
      fingerprint(evidence),
      JSON.stringify({
        ...profile,
        mode: "synthetic_demo",
        coverage: { note: "Invented fixture data; no model was called" },
      }),
    );
  }
  store.event(
    "demo_complete",
    "all",
    "Synthetic collection → unchanged → changed → proposed profiles. No network or model calls.",
  );
}
