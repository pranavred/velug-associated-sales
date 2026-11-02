import type { Plant } from "./seeds.js";
import type { Store } from "./store.js";
const brewery = {
  title: "Ecolab brewery product guide (2019), pp. 1–2",
  url: "https://www.ecolab.com/-/media/Ecolab/Ecolab-Home/Documents/DocumentLibrary/F-and-B/Brewery-Product-Guide_FINAL-0619-pdf.pdf",
  scope:
    "Industry applications only; not evidence of a supplier relationship or current product availability.",
};
const dairy = {
  title: "Ecolab dairy processing: enzymatic CIP",
  url: "https://www.ecolab.com/en-us/about/industries-we-serve/food-and-beverage-processing/dairy-processing",
  scope:
    "Supplier technical/marketing literature; application relevance, not plant adoption.",
};
const boiler = {
  title: "Nalco Water: pre-boiler corrosion control",
  url: "https://en-uk.ecolab.com/nalco-water/offerings/pre-boiler-corrosion-control",
  scope:
    "General application reference; suitability depends on the actual steam system.",
};
const wastewater = {
  title: "Kurita: wastewater treatment technologies",
  url: "https://www.kuritaamerica.com/solutions/wastewater",
  scope:
    "General treatment applications; not a finding about this plant’s treatment train.",
};
type Rule = {
  id: string;
  title: string;
  categories: string[];
  angle: string;
  why: string;
  questions: string[];
  disqualifiers: string[];
  roles: string[];
  sources: (typeof brewery)[];
  match?: RegExp;
  sector?: string[];
  type: string;
};
const rules: Rule[] = [
  {
    id: "brewery-cip",
    title: "CIP cleaning performance",
    categories: [
      "Alkaline/caustic detergents",
      "Acid cleaners",
      "Oxygen-based cleaning boosters",
    ],
    angle:
      "Qualify a cleaning booster if difficult soils remain despite a validated wash program.",
    why: "Brewery literature describes alkaline/acid cleaning and specialized CIP additives. This creates an application hypothesis, not proof of this plant’s cleaning formulation.",
    questions: [
      "What formulated cleaner and additives are already in the program?",
      "Are residual soils or repeat washes a measured problem?",
      "Has flow, temperature and equipment performance been ruled out before changing chemistry?",
    ],
    disqualifiers: [
      "Existing formulation already supplies the needed function",
      "No documented cleaning-performance gap",
      "Proposed additive is incompatible with the validated program",
    ],
    roles: ["Sanitation manager", "Quality team", "Process engineer"],
    sources: [brewery],
    sector: ["PLANT-002", "PLANT-003"],
    type: "Potential add-on",
  },
  {
    id: "brewery-sanitizer",
    title: "Sanitation program optimization",
    categories: ["Peroxyacid-based sanitizers"],
    angle:
      "Explore a program improvement if validated sanitation performance or cycle time is a customer priority.",
    why: "Brewery application literature includes sanitizer programs. Existing chemistry and site constraints are unknown.",
    questions: [
      "Which sanitizer program is validated today?",
      "What measurable outcome is the team trying to improve?",
    ],
    disqualifiers: [
      "No demonstrated performance or cost gap",
      "Proposed product does not meet the site’s application requirements",
    ],
    roles: ["Quality team", "Sanitation manager"],
    sources: [brewery],
    sector: ["PLANT-002", "PLANT-003"],
    type: "Program alternative—not necessarily an add-on",
  },
  {
    id: "dairy-cip",
    title: "Cleaning booster for dairy soils",
    categories: [
      "Sodium hydroxide (caustic soda)",
      "Nitric acid",
      "Enzymatic CIP cleaners / cleaning aids",
    ],
    angle:
      "Investigate an enzyme-assisted cleaning step if the customer reports persistent buildup or repeat cleaning.",
    why: "The site has reported CIP infrastructure; dairy-processing literature describes enzymatic cleaning applications.",
    questions: [
      "What soil is limiting the existing cleaning program?",
      "Are repeat washes or long cycles documented?",
      "Would the proposed change complement or replace an existing step?",
    ],
    disqualifiers: [
      "No relevant soil-removal problem",
      "Existing program already addresses it",
      "Incompatible materials, operating conditions or validated process",
    ],
    roles: ["Sanitation manager", "Process engineer", "Quality team"],
    sources: [
      dairy,
      {
        title: "Tetra Pak Dairy Processing Handbook: cleaning dairy equipment",
        url: "https://dairyprocessinghandbook.tetrapak.com/chapter/cleaning-dairy-equipment",
        scope:
          "Industry reference for alkaline and acid dairy cleaning, not evidence of this plant’s chemical use.",
      },
    ],
    match: /\bCIP\b|cleaning.in.place/i,
    sector: ["PLANT-001", "PLANT-004"],
    type: "Potential add-on or program change",
  },
  {
    id: "boiler",
    title: "Boiler oxygen-control program",
    categories: ["Sulfite-based oxygen scavengers"],
    angle:
      "Evaluate treatment optimization where measured oxygen/corrosion problems or operating cost justify it.",
    why: "A documented boiler/steam-related process makes water-treatment qualification relevant. It does not establish a missing scavenger.",
    questions: [
      "What treatment and deaeration program is already operating?",
      "What do water tests and corrosion records show?",
      "What are the steam end uses and boiler operating conditions?",
    ],
    disqualifiers: [
      "No boiler treatment gap",
      "Existing chemistry performs adequately",
      "Candidate chemistry is unsuitable for the system or steam end use",
    ],
    roles: ["Utilities manager", "Water-treatment engineer"],
    sources: [boiler],
    match: /boiler|steam traps/i,
    type: "Treatment-program optimization",
  },
  {
    id: "wastewater",
    title: "Wastewater separation and foam-control assessment",
    categories: ["Coagulants", "Flocculant polymers", "Antifoam products"],
    angle:
      "Qualify a treatment aid if solids separation, sludge handling or foam is an actual bottleneck.",
    why: "Wastewater evidence creates a reason to ask about treatment design. An MBBR permit alone does not establish a chemical-separation stage.",
    questions: [
      "Is the permitted expansion operating?",
      "Does the treatment train include flotation, clarification or dewatering?",
      "Are solids, foam or sludge costs measured problems?",
      "Would bench/pilot tests show benefit without impairing biological treatment?",
    ],
    disqualifiers: [
      "No applicable treatment stage or measured issue",
      "MBBR-only inference without confirming the broader train",
      "Existing aid already solves the problem",
    ],
    roles: [
      "Wastewater operator",
      "Environmental manager",
      "Utilities engineer",
    ],
    sources: [wastewater],
    match: /wastewater|MBBR|EQ.tank/i,
    type: "Conditional add-on assessment",
  },
];
export function opportunities(
  plant: Plant,
  profile: any,
  unsupported: string[],
) {
  if (
    !profile ||
    !["codex_assisted_review", "live_model"].includes(profile.mode) ||
    plant.hold ||
    profile.prospect_status === "suppressed_pending_review" ||
    profile.claims.some((c: any) => c.classification === "closure_announcement")
  )
    return [];
  const claims = profile.claims.filter(
    (c: any) =>
      !unsupported.includes(c.id) &&
      c.classification !== "regulatory_boilerplate" &&
      !["wrong_site", "uncertain"].includes(c.site_match),
  );
  return rules.flatMap((rule) => {
    if (rule.sector && !rule.sector.includes(plant.id)) return [];
    const supporting = rule.match
      ? claims.filter((c: any) => rule.match!.test(c.statement + " " + c.quote))
      : [];
    if (rule.match && !supporting.length) return [];
    if (!rule.match && !claims.length) return [];
    return [
      {
        id: rule.id,
        title: rule.title,
        categories: rule.categories,
        status: "potential—not verified in use",
        basis: supporting.length ? "documented-process" : "industry-pattern",
        priority: supporting.length
          ? "Investigate process fit"
          : "Confirm site application first",
        opportunity_type: rule.type,
        why: rule.why,
        sales_angle: rule.angle,
        qualification_questions: rule.questions,
        disqualifiers: rule.disqualifiers,
        roles_to_approach: rule.roles,
        industry_sources: rule.sources,
        plant_evidence: supporting.map((c: any) => ({
          claim_id: c.id,
          source_id: c.source_id,
          version: c.version,
          locator: c.locator,
          temporal_scope: c.temporal_scope,
        })),
        known_use: false,
        incumbent_supplier: "Unknown",
        buyer_contact: "Unknown",
        purchase_volume: "Unknown",
        seller_catalog_match: "Not assessed; supplier-neutral",
        logic_version: "supplier-neutral-rules-v1",
      },
    ];
  });
}
export function opportunityState(store: Store) {
  return store
    .all(
      "SELECT * FROM profiles WHERE id IN (SELECT MAX(id) FROM profiles GROUP BY plant)",
    )
    .flatMap((row) => {
      const plantRow = store.get(
        "SELECT json FROM plants WHERE id=?",
        row.plant,
      );
      if (!plantRow) return [];
      const reviews = store.all(
        "SELECT * FROM reviews WHERE kind='claim' ORDER BY id DESC",
      );
      const latest = new Map<string, string>();
      for (const r of reviews)
        if (!latest.has(r.target)) latest.set(r.target, r.decision);
      const p = JSON.parse(row.json);
      const unsupported = p.claims
        .filter((c: any) => latest.get(row.id + ":" + c.id) === "unsupported")
        .map((c: any) => c.id);
      return opportunities(JSON.parse(plantRow.json), p, unsupported).map(
        (o) => ({
          ...o,
          plant_id: row.plant,
          seller_example: brenntagFit(o.id),
          profile_id: row.id,
          evidence_freshness: o.plant_evidence.some(
            (e: { source_id: string; version: string }) =>
              store.get("SELECT version FROM sources WHERE id=?", e.source_id)
                ?.version !== e.version,
          )
            ? "Supporting source changed; re-review needed"
            : "Check historical dates and current site status",
        }),
      );
    });
}

export function brenntagFit(id: string) {
  const common = {
    seller: "Brenntag",
    relationship:
      "Illustrative seller; no customer relationship asserted",
    reviewed_on: "2026-10-23",
  };
  if (id === "wastewater")
    return {
      ...common,
      status: "Public category match",
      categories: ["Coagulants", "Flocculants", "Defoamers"],
      source_url:
        "https://www.brenntag.com/en-us/industries/water-treatment/industrial/food-and-beverage/",
      qualification:
        "Brenntag publicly lists these categories for food/beverage water treatment. Specific grade, site suitability, availability and an unmet need remain to be qualified.",
    };
  if (id === "brewery-cip")
    return {
      ...common,
      status: "Partial match—base chemistry only",
      categories: ["Caustic soda (sodium hydroxide)"],
      source_url: "https://www.brenntag.com/en-us/products/caustic-soda.html",
      qualification:
        "Public base-chemical listing. It does not establish a Brenntag cleaning booster, an approved CIP formulation, or a new add-on opportunity at this brewery.",
    };
  return {
    ...common,
    status: "Portfolio fit not yet verified",
    categories: [] as string[],
    source_url: null,
    qualification:
      "Industry application is plausible; a matching Brenntag product/grade has not been verified in this pass.",
  };
}
