/** An evidence projection, not an independently verified equipment inventory. */
type Group = "products" | "equipment" | "permits" | "changes";
type Claim = {
  id: string;
  statement: string;
  quote: string;
  classification: string;
  site_match: string;
  temporal_scope: string;
  source_id: string;
  locator: string;
  version: string;
};
const rules: { match: RegExp; group: Group; labels: string[] }[] = [
  {
    match: /strained-yogurt production/i,
    group: "products",
    labels: ["Strained yogurt"],
  },
  {
    match: /Baldwinsville brewery at/i,
    group: "products",
    labels: ["Beer · brewery identified"],
  },
  {
    match: /brewhouse emissions/i,
    group: "products",
    labels: ["Beer · brewhouse reported"],
  },
  {
    match: /brewhouse emissions/i,
    group: "equipment",
    labels: ["Brewhouse", "Natural-gas boiler · historical"],
  },
  {
    match: /chemical receiving and CIP rooms/i,
    group: "equipment",
    labels: ["Chemical receiving", "CIP rooms · reported project"],
  },
  {
    match: /process wastewater, non-contact cooling/i,
    group: "equipment",
    labels: [
      "Process wastewater",
      "Non-contact cooling water",
      "Boiler blowdown",
    ],
  },
  {
    match: /ten tanks with stated capacities/i,
    group: "equipment",
    labels: ["10 tanks · project scope"],
  },
  {
    match: /ingredient-mixing rooms/i,
    group: "equipment",
    labels: ["Ingredient mixing rooms"],
  },
  {
    match: /condensate piping associated with 20 HVAC/i,
    group: "equipment",
    labels: ["20 HVAC units · project scope"],
  },
  {
    match: /removable insulation covers for new steam traps/i,
    group: "equipment",
    labels: ["Steam traps · reported project"],
  },
  {
    match: /permits NY0004189/i,
    group: "permits",
    labels: ["Water discharge · NY0004189"],
  },
  {
    match: /effective period of November 1, 2024/i,
    group: "permits",
    labels: ["Permit term · 2024–2029"],
  },
  {
    match: /DEC review identifies the Baldwinsville brewery/i,
    group: "permits",
    labels: ["Air permit review · 2015"],
  },
  {
    match: /air permit associates High Falls/i,
    group: "permits",
    labels: ["Air permit · 2016–2026"],
  },
  {
    match: /historical DEC review identifies American Sugar/i,
    group: "permits",
    labels: ["Air permit review · 2010"],
  },
  {
    match: /13,500-square-foot New Berlin expansion/i,
    group: "changes",
    labels: ["13,500 sq ft expansion · undated project"],
  },
  {
    match: /Insulation contractor labels its project/i,
    group: "changes",
    labels: ["Insulation project · Oct 2025"],
  },
  {
    match: /EQ-tank wastewater expansion permit/i,
    group: "changes",
    labels: ["EQ tank permit · Feb 2026"],
  },
  {
    match: /MBBR-tank wastewater expansion permit/i,
    group: "changes",
    labels: ["MBBR tank permit · Feb 2026"],
  },
  {
    match: /EQ-tank wastewater expansion permit/i,
    group: "permits",
    labels: ["Construction · 26-0166"],
  },
  {
    match: /MBBR-tank wastewater expansion permit/i,
    group: "permits",
    labels: ["Construction · 26-0278"],
  },
  {
    match: /ASR announced planned Yonkers closure/i,
    group: "changes",
    labels: ["Closure planned · end of 2025"],
  },
];
export function plantOverviews(
  profiles: { plant: string; profile: { claims?: Claim[] } }[],
  sources: { id: string; version?: string }[] = [],
) {
  return profiles.map((row) => {
    const sections: Record<Group, any[]> = {
      products: [],
      equipment: [],
      permits: [],
      changes: [],
    };
    for (const c of row.profile.claims || []) {
      if (
        ["wrong_site", "uncertain"].includes(c.site_match) ||
        c.classification === "regulatory_boilerplate"
      )
        continue;
      const matches = rules.filter((r) => r.match.test(c.statement));
      for (const rule of matches)
        for (const label of rule.labels)
          sections[rule.group].push({
            label,
            ...c,
            stale: sources.some(
              (s) => s.id === c.source_id && s.version !== c.version,
            ),
          });
      // New agent claims remain visible even before a concise display rule exists.
      if (!matches.length) {
        const group: Group | undefined = /announcement/.test(c.classification)
          ? "changes"
          : /manufactur|produc|makes? /i.test(c.statement)
            ? "products"
            : /permit/i.test(c.statement)
              ? "permits"
              : /boiler|tank|cooling|equipment|CIP|wastewater/i.test(
                    c.statement,
                  )
                ? "equipment"
                : undefined;
        if (group)
          sections[group].push({
            label: c.statement,
            ...c,
            stale: sources.some(
              (s) => s.id === c.source_id && s.version !== c.version,
            ),
          });
      }
    }
    return { plant_id: row.plant, sections };
  });
}
