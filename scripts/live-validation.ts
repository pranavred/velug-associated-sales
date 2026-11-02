import { NodeDatabase } from "../app/node-db.js";
import {
  bootstrap,
  signIn,
  sessionPrincipal,
  randomToken,
} from "../app/auth.js";
import { importInventory } from "../app/inventory.js";
import { configuration } from "../app/config.js";
import { createResearch, processResearch, getResearch } from "../app/jobs.js";
import { mkdir, writeFile } from "node:fs/promises";
if (!process.env.OPENAI_API_KEY)
  throw Error(
    "Set OPENAI_API_KEY to run the opt-in, billable live validation.",
  );
const db = new NodeDatabase(":memory:");
try {
  const password = randomToken();
  await bootstrap(db, {
    email: "validation@example.test",
    password,
    company: "Synthetic validation supplier",
  });
  const p = (await sessionPrincipal(
    db,
    (await signIn(db, "validation@example.test", password)).token,
  ))!;
  await importInventory(db, p, {
    source: "synthetic",
    key: "validation",
    mode: "replace",
    rows: [
      {
        sku: "FILTER-10",
        name: "10-micron process-water filter cartridge",
        description:
          "Synthetic test product. Polypropylene sediment filter cartridge for industrial water pretreatment. Not a sterilizing filter; installation dimensions, flow and application suitability need review.",
        applications: ["process water filtration", "sediment removal"],
        quantity: 250,
        unit: "cartridges",
        regions: ["US"],
      },
      {
        sku: "CARBON",
        name: "Activated carbon filtration media",
        description:
          "Synthetic test product. Granular media for water-treatment applications. Technical review required for target contaminants, breakthrough, contact time and media certification.",
        applications: ["water treatment"],
        quantity: 1200,
        unit: "kg",
        regions: ["US"],
      },
      {
        sku: "GASKET",
        name: "EPDM sanitary gasket assortment",
        description:
          "Synthetic test product. Replacement gaskets for sanitary process pipework. Verify dimensions, formulation, certification, chemical exposure and temperature with engineering.",
        applications: ["sanitary pipe maintenance"],
        quantity: 90,
        unit: "kits",
        regions: ["US"],
      },
      {
        sku: "CLEANER",
        name: "Alkaline industrial cleaning concentrate",
        description:
          "Synthetic test product. Intended for professionally designed industrial cleaning programs. No dosage or compatibility is established; requires current SDS, TDS and qualified technical approval.",
        applications: ["industrial cleaning"],
        quantity: 300,
        unit: "litres",
        regions: ["US"],
      },
      {
        sku: "ZERO",
        name: "Unavailable stainless process valve",
        quantity: 0,
        regions: ["US"],
      },
      {
        sku: "INACTIVE",
        name: "Discontinued filtration skid",
        quantity: 1,
        active: false,
        regions: ["US"],
      },
    ],
  });
  const config = configuration({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MAX_MODEL_CALLS_PER_DAY: "2",
  });
  const job = await createResearch(
    db,
    p,
    {
      name: "Sierra Nevada Brewing Co.",
      website: "https://sierranevada.com",
      location: "Chico, California, United States",
      region: "US",
      depth: "deep",
      objective:
        "Identify documented brewery operations and maintenance or process-water needs worth qualifying against the supplied synthetic industrial catalog.",
      requestKey: crypto.randomUUID(),
    },
    config,
  );
  await processResearch(db, job.id, config);
  const result = await getResearch(db, p, job.id, config);
  await mkdir("data", { recursive: true });
  await writeFile("data/live-validation.json", JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        status: result.status,
        error: result.error,
        sources: result.research?.sources.length,
        identity: result.result?.identity,
        coverage: result.result?.coverage,
        opportunities: result.result?.opportunities.map((o: any) => ({
          sku: o.product.sku,
          questions: o.questions,
        })),
        usage: result.usage,
      },
      null,
      2,
    ),
  );
  if (result.status !== "complete") process.exitCode = 1;
} finally {
  db.close();
}
