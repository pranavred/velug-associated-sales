import type { Evidence } from "./agents.js";
export const reference = [
  ["C01", "Facility identity and aliases"],
  ["C02", "Permit effective and expiration dates"],
  ["C03", "Unadilla River receiving water"],
  ["C04", "Four listed wastewater streams"],
  ["C05", "13,500-square-foot expansion"],
  ["C06", "Ten tanks; 10,000–70,000 gallon range, no aggregate total"],
  ["C07", "Ingredient-mixing rooms"],
  ["C08", "Chemical receiving and CIP rooms"],
  ["C09", "Strained-yogurt production"],
  ["C10", "October 2025 insulation project date"],
  ["C11", "Condensate piping associated with 20 HVAC units"],
  ["C12", "Removable insulation covers on steam traps"],
].map(([id, description]) => ({ id, description }));
export type Judgment = {
  claim_id: string;
  supported: boolean | null;
  wrong_site: boolean | null;
  unsupported_chemical_assertion: boolean | null;
  reference_ids: string[];
};
export function evaluate(
  profile: { claims: any[] },
  evidence: Evidence[],
  judgments: Judgment[],
) {
  const claims = profile.claims;
  const ids = new Set(claims.map((c) => c.id));
  if (ids.size !== claims.length) throw new Error("Duplicate claim IDs");
  const seen = new Set<string>();
  for (const j of judgments) {
    if (!ids.has(j.claim_id) || seen.has(j.claim_id))
      throw new Error("Judgment refers to missing or duplicate claim");
    seen.add(j.claim_id);
    for (const id of j.reference_ids)
      if (!reference.some((r) => r.id === id))
        throw new Error("Unknown reference ID");
  }
  const citations = claims.map((c) => ({
    claim_id: c.id,
    traceable: evidence.some(
      (e) =>
        e.source_id === c.source_id &&
        e.version === c.version &&
        e.segments.some(
          (s) =>
            s.locator === c.locator &&
            typeof c.quote === "string" &&
            c.quote.trim().length >= 15 &&
            s.text.includes(c.quote),
        ),
    ),
  }));
  const scored = judgments.filter((j) => j.supported !== null);
  const supported = scored.filter((j) => j.supported === true);
  const covered = new Set(supported.flatMap((j) => j.reference_ids));
  const fullyReviewed = claims.every((c) =>
    judgments.some(
      (j) =>
        j.claim_id === c.id &&
        j.supported !== null &&
        j.wrong_site !== null &&
        j.unsupported_chemical_assertion !== null,
    ),
  );
  return {
    claim_count: claims.length,
    citations,
    traceable_claims: citations.filter((c) => c.traceable).length,
    semantic_reviewed_claims: scored.length,
    support_precision: scored.length ? supported.length / scored.length : null,
    reference_coverage: {
      covered: [...covered],
      total: reference.length,
      ratio: covered.size / reference.length,
      remaining: reference.filter((r) => !covered.has(r.id)),
    },
    wrong_site_count: judgments.some((j) => j.wrong_site !== null)
      ? judgments.filter((j) => j.wrong_site === true).length
      : null,
    unsupported_chemical_assertion_count: judgments.some(
      (j) => j.unsupported_chemical_assertion !== null,
    )
      ? judgments.filter((j) => j.unsupported_chemical_assertion === true)
          .length
      : null,
    review_complete: fullyReviewed,
    note: "Exact quote checks measure traceability only. Semantic metrics require explicit reviewer judgments; unreviewed claims are not treated as false. Coverage applies only to this small 12-item Chobani baseline.",
  };
}
export function diffSegments(
  before: { locator: string; text: string }[],
  after: { locator: string; text: string }[],
) {
  const a = new Map(before.map((s) => [s.locator, s.text])),
    b = new Map(after.map((s) => [s.locator, s.text]));
  return [...new Set([...a.keys(), ...b.keys()])].flatMap((locator) => {
    const old = a.get(locator),
      next = b.get(locator);
    return old === next
      ? []
      : [
          {
            locator,
            kind:
              old === undefined
                ? "added"
                : next === undefined
                  ? "removed"
                  : "changed",
            before: old ?? null,
            after: next ?? null,
          },
        ];
  });
}
