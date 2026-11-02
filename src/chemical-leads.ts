/** Estimated-use index, not a calibrated probability or a purchasing-intent score. */
export const confidenceModel = {
  version: "estimated-use-v1",
  label: "Estimated use confidence",
  explanation:
    "A 0–100 heuristic for discussing possible chemical use. It is not a percentage probability, proof of use, or buying intent.",
};
const names: Record<string, string> = {
  "Alkaline/caustic detergents": "Caustic cleaners",
  "Acid cleaners": "Acid cleaners",
  "Oxygen-based cleaning boosters": "Oxygen cleaning boosters",
  "Peroxyacid-based sanitizers": "Peroxyacid sanitizers",
  "Enzymatic CIP cleaners / cleaning aids": "Enzymatic cleaners",
  "Sulfite-based oxygen scavengers": "Sulfite oxygen scavengers",
  Coagulants: "Coagulants",
  "Flocculant polymers": "Flocculant polymers",
  "Antifoam products": "Defoamers",
};
const questions: Record<string, string> = {
  "Sodium hydroxide (caustic soda)":
    "What caustic cleaning program do you use today, and are repeat washes or chemical costs a concern?",
  "Nitric acid":
    "Do you use nitric acid or another acid cleaner for mineral deposits? Is scale removal meeting your needs?",
  "Caustic cleaners":
    "What alkaline cleaner do you use today, and where does the current cleaning program fall short?",
  "Acid cleaners":
    "How are you handling mineral buildup, and which acid-cleaning program do you use?",
  "Oxygen cleaning boosters":
    "Do persistent residues or repeat washes create a need for a cleaning booster?",
  "Peroxyacid sanitizers":
    "Which sanitizer is in your program today, and are cycle time or performance a concern?",
  "Enzymatic cleaners":
    "Are protein or fat residues leading to repeat washes? Have you evaluated an enzyme-assisted cleaning step?",
  "Sulfite oxygen scavengers":
    "What oxygen-control chemistry do you use for boiler feedwater, and are corrosion or treatment costs an issue?",
  Coagulants:
    "Does your wastewater process include solids separation, and what coagulant program are you using?",
  "Flocculant polymers":
    "Are settling, dewatering or sludge costs a challenge? What polymers are in use today?",
  Defoamers:
    "Is foam affecting wastewater operations, and how are you controlling it today?",
};
export function chemicalLeads(
  opportunities: any[],
  profiles: any[],
  sources: any[] = [],
) {
  const leads = opportunities.flatMap((o) =>
    o.categories.map((category: string) => {
      const name = names[category] || category;
      const profile = profiles.find(
        (p) =>
          p.plant === o.plant_id && (p.id === o.profile_id || !o.profile_id),
      )?.profile;
      const evidence = (o.plant_evidence || []).map((e: any) => ({
        ...e,
        source_url: sources.find((s) => s.id === e.source_id)?.url || null,
      }));
      const claims = evidence
        .map((e: any) => profile?.claims?.find((c: any) => c.id === e.claim_id))
        .filter(Boolean);
      const factors: { label: string; points: number }[] = [
        {
          label:
            o.basis === "documented-process"
              ? "Plant-specific process evidence"
              : "Industry application pattern",
          points: o.basis === "documented-process" ? 55 : 30,
        },
      ];
      if (claims.some((c: any) => c.site_match === "exact_identifier"))
        factors.push({
          label: "Exact facility identifier in supporting evidence",
          points: 10,
        });
      if (["Enzymatic cleaners", "Oxygen cleaning boosters"].includes(name))
        factors.push({
          label: "Specialty add-on; a performance problem is not established",
          points: -15,
        });
      if (["Coagulants", "Flocculant polymers"].includes(name))
        factors.push({
          label: "Separation stage has not been established",
          points: -10,
        });
      if (name === "Defoamers")
        factors.push({
          label: "An operating foam problem has not been established",
          points: -15,
        });
      if (name === "Sulfite oxygen scavengers")
        factors.push({
          label: "Existing treatment and steam end use are unknown",
          points: -10,
        });
      if (
        evidence.some(
          (e: any) =>
            sources.find((s) => s.id === e.source_id)?.version !== e.version,
        )
      )
        factors.push({
          label: "Supporting document changed since extraction",
          points: -15,
        });
      // Process and industry inferences never get a documented-use score.
      const score = Math.max(
        5,
        Math.min(
          70,
          factors.reduce((n, f) => n + f.points, 0),
        ),
      );
      return {
        id:
          o.plant_id +
          ":" +
          o.id +
          ":" +
          name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        plant_id: o.plant_id,
        profile_id: o.profile_id,
        chemical_name: name,
        chemical_kind: [
          "Sodium hydroxide (caustic soda)",
          "Nitric acid",
        ].includes(name)
          ? "Chemical"
          : "Chemical family",
        application:
          o.id.startsWith("brewery") || o.id === "dairy-cip"
            ? "Cleaning & sanitation"
            : o.id === "boiler"
              ? "Boiler water"
              : "Wastewater treatment",
        confidence: {
          score,
          scale: 100,
          model: confidenceModel.version,
          label:
            score >= 60
              ? "Stronger indication"
              : score >= 40
                ? "Plausible"
                : "Exploratory",
          factors,
        },
        basis:
          o.basis === "documented-process" ? "Process-based" : "Industry-based",
        relationship: "potential_use",
        known_use: false,
        reason: ["Sodium hydroxide (caustic soda)", "Nitric acid"].includes(
          name,
        )
          ? "This plant has reported CIP infrastructure. Tetra Pak’s dairy-processing handbook describes caustic and nitric-acid cleaning as common applications worth qualifying here."
          : o.why,
        question: questions[name] || o.qualification_questions[0],
        disqualifiers: o.disqualifiers,
        roles: o.roles_to_approach,
        evidence,
        industry_sources: o.industry_sources,
        seller: o.seller_example || null,
        opportunity_id: o.id,
      };
    }),
  );
  return leads.sort(
    (a, b) =>
      b.confidence.score - a.confidence.score ||
      ["Cleaning & sanitation", "Boiler water", "Wastewater treatment"].indexOf(
        a.application,
      ) -
        [
          "Cleaning & sanitation",
          "Boiler water",
          "Wastewater treatment",
        ].indexOf(b.application) ||
      a.chemical_name.localeCompare(b.chemical_name),
  );
}
