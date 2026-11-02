import { z } from "zod";
import type { Plant } from "./seeds.js";
export const Claim = z.object({
  id: z.string(),
  statement: z.string(),
  source_id: z.string(),
  locator: z.string(),
  quote: z.string(),
  site_match: z.enum([
    "exact_identifier",
    "locality_only",
    "wrong_site",
    "uncertain",
  ]),
  classification: z.enum([
    "reported_fact",
    "regulatory_boilerplate",
    "announcement",
    "closure_announcement",
  ]),
  temporal_scope: z.string(),
});
export const Profile = z.object({
  claims: z.array(Claim),
  hypotheses: z.array(
    z.object({
      question: z.string(),
      claim_ids: z.array(z.string()),
      missing_evidence: z.array(z.string()),
    }),
  ),
  unknowns: z.array(z.string()),
});
export type Evidence = {
  source_id: string;
  url: string;
  version: string;
  segments: { locator: string; text: string }[];
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function validateProfile(
  input: z.infer<typeof Profile>,
  evidence: Evidence[],
  plant: Plant,
) {
  const accepted: any[] = [],
    rejected: any[] = [];
  const seen = new Set<string>();
  for (const c of input.claims) {
    let reason = "";
    const doc = evidence.find((e) => e.source_id === c.source_id);
    const segment = doc?.segments.find((s) => s.locator === c.locator);
    if (seen.has(c.id)) reason = "Duplicate claim ID";
    else if (c.quote.trim().length < 15 || !segment?.text.includes(c.quote))
      reason = "Quote not found verbatim at cited locator";
    else if (c.site_match === "wrong_site" || c.site_match === "uncertain")
      reason = "Facility attribution unresolved";
    else if (c.classification === "regulatory_boilerplate")
      reason = "General regulation is not facility inventory";
    else if (
      c.site_match === "exact_identifier" &&
      !plant.identity.some((id) => norm(c.quote).includes(norm(id)))
    )
      reason = "Exact-site claim lacks identifier in quoted evidence";
    seen.add(c.id);
    if (reason) rejected.push({ ...c, rejection_reason: reason });
    else
      accepted.push({
        ...c,
        version: doc!.version,
        review_status: "human_review_pending",
      });
  }
  const ids = new Set(accepted.map((c) => c.id));
  const hypotheses = input.hypotheses
    .filter(
      (h) => h.claim_ids.length > 0 && h.claim_ids.every((id) => ids.has(id)),
    )
    .map((h) => ({ ...h, status: "unvalidated_research_question" }));
  return {
    claims: accepted,
    rejected,
    hypotheses,
    unknowns: input.unknowns,
    prospect_status:
      plant.hold ||
      accepted.some((c) => c.classification === "closure_announcement")
        ? "suppressed_pending_review"
        : "unqualified_research_only",
    publication_dates:
      "Unknown unless independently reviewed; fetch time is not publication time",
    review_note:
      "Quote checks verify traceability, not entailment or factual correctness. All model claims require human review.",
  };
}
