import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeDatabase } from "../app/node-db.js";
import { bootstrap, signIn, sessionPrincipal } from "../app/auth.js";
import { importInventory, listInventory } from "../app/inventory.js";
import { configuration } from "../app/config.js";
import {
  OpenAIProvider,
  validateMatches,
  evidenceCaution,
  researchInput,
} from "../app/provider.js";
import {
  createResearch,
  processResearch,
  getResearch,
  cancelResearch,
  reviewOpportunity,
  recoverInterrupted,
} from "../app/jobs.js";
const config = configuration({
  OPENAI_API_KEY: "test-only-key",
  MAX_MODEL_CALLS_PER_DAY: "4",
});
const report = (id: string) => ({
  identity: {
    name: "Example Manufacturing",
    status: "identified",
    reason: "Official company sources",
  },
  companySummary: "Manufactures food products.",
  findings: [
    {
      statement: "The company operates food production sites.",
      evidenceDate: "2026-01-01",
      sourceIds: ["S1"],
    },
  ],
  opportunities: [
    {
      productId: id,
      type: "complementary",
      rationale: "Investigate process-water filtration requirements.",
      sourceIds: ["S1"],
      questions: [
        "What particulate load and flow rate must the filter handle?",
      ],
      missingRequirements: ["Flow rate"],
      disqualifiers: ["Existing filtration already covers this requirement"],
    },
  ],
  unknowns: ["Current supplier unknown"],
});
const artifact = {
  narrative: "Example Manufacturing operates food production sites.",
  sources: [
    {
      id: "S1",
      url: "https://example.com/manufacturing",
      title: "Manufacturing",
    },
  ],
  usage: {
    responseId: "resp_research",
    model: "fixture",
    inputTokens: 100,
    outputTokens: 40,
    searchCalls: 1,
  },
};
async function setup() {
  const db = new NodeDatabase(":memory:");
  await bootstrap(db, {
    email: "owner@example.test",
    password: "long test owner passphrase",
    company: "Seller",
  });
  const p = (await sessionPrincipal(
    db,
    (await signIn(db, "owner@example.test", "long test owner passphrase"))
      .token,
  ))!;
  await importInventory(db, p, {
    source: "erp",
    key: "one",
    mode: "replace",
    rows: [
      {
        sku: "FILTER",
        name: "Process water filter",
        applications: ["filtration"],
        quantity: 10,
        regions: ["US"],
      },
      { sku: "ZERO", name: "Unavailable", quantity: 0 },
    ],
  });
  return {
    db,
    p,
    product: (await listInventory(db, p)).find((x) => x.sku === "FILTER")!,
  };
}
test("model output cannot invent catalog products or evidence; ambiguous identity suppresses suggestions", async () => {
  const { db, product } = await setup();
  try {
    assert.equal(
      validateMatches(report(product.id), artifact, [product]).opportunities
        .length,
      1,
    );
    assert.throws(
      () =>
        validateMatches(report("other-company-product"), artifact, [product]),
      /product/i,
    );
    const unsupported = report(product.id);
    unsupported.opportunities[0].sourceIds = ["FORGED"];
    assert.throws(
      () => validateMatches(unsupported, artifact, [product]),
      /source/i,
    );
    const ambiguous = report(product.id);
    ambiguous.identity.status = "ambiguous";
    assert.equal(
      validateMatches(ambiguous, artifact, [product]).opportunities.length,
      0,
    );
    assert.throws(
      () =>
        researchInput({ name: "x", website: "http://127.0.0.1", region: "US" }),
      /name|website/i,
    );
  } finally {
    db.close();
  }
});
test("provider requires real search provenance and rejects partial or malformed responses", async () => {
  const { db, product } = await setup();
  try {
    const provider = new OpenAIProvider(config, async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.equal(body.store, false);
      assert(!JSON.stringify(body).includes("quantity"));
      if (body.tools)
        return Response.json({
          id: "resp_search",
          model: "fixture",
          status: "completed",
          usage: { input_tokens: 2, output_tokens: 3 },
          output: [
            {
              type: "web_search_call",
              status: "completed",
              action: {
                sources: [{ url: "https://example.com/manufacturing" }],
              },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Manufacturing report",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://example.com/manufacturing",
                      title: "Manufacturing",
                    },
                  ],
                },
              ],
            },
          ],
        });
      return Response.json({
        id: "resp_match",
        model: "fixture",
        status: "completed",
        usage: { input_tokens: 3, output_tokens: 5 },
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: JSON.stringify(report(product.id)) },
            ],
          },
        ],
      });
    });
    const input = researchInput({
        name: "Example Manufacturing",
        region: "US",
      }),
      research = await provider.research(input);
    assert.equal(research.sources[0].url, "https://example.com/manufacturing");
    assert.equal(
      (await provider.match(input, research, [product])).report.opportunities[0]
        .productId,
      product.id,
    );
    const noSearch = new OpenAIProvider(config, async () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Uncited claim" }],
          },
        ],
      }),
    );
    await assert.rejects(noSearch.research(input), /search|source/i);
    const incomplete = new OpenAIProvider(config, async () =>
      Response.json({ status: "incomplete", output: [] }),
    );
    await assert.rejects(incomplete.research(input), /complete/i);
  } finally {
    db.close();
  }
});
test("durable jobs coalesce active duplicates, run once, enforce ownership and save rep answers", async () => {
  const { db, p, product } = await setup();
  try {
    let calls = 0;
    const provider = {
      research: async () => {
        calls++;
        return artifact;
      },
      match: async () => {
        calls++;
        return {
          report: validateMatches(report(product.id), artifact, [product]),
          usage: {
            ...artifact.usage,
            responseId: "resp_match",
            searchCalls: 0,
          },
        };
      },
    };
    const input = { name: "Example Manufacturing", region: "US" };
    const job = await createResearch(db, p, input, config);
    assert.equal((await createResearch(db, p, input, config)).id, job.id);
    await Promise.all([
      processResearch(db, job.id, config, provider),
      processResearch(db, job.id, config, provider),
    ]);
    assert.equal(calls, 2);
    const result = await getResearch(db, p, job.id, config);
    assert.equal(result.status, "complete");
    assert.equal(result.result.opportunities[0].product.id, product.id);
    await assert.rejects(
      getResearch(db, { ...p, companyId: "foreign" }, job.id, config),
      /not found/i,
    );
    await reviewOpportunity(db, p, job.id, product.id, {
      decision: "pending",
      answers: ["Need 20 cubic meters per hour"],
      note: "Confirm filtration rating",
    });
    assert.equal(
      (await getResearch(db, p, job.id, config)).reviews[0].answers[0],
      "Need 20 cubic meters per hour",
    );
    await importInventory(db, p, {
      source: "erp",
      key: "sold-out",
      mode: "replace",
      rows: [{ sku: "FILTER", name: "Process water filter", quantity: 0 }],
    });
    const current = await getResearch(db, p, job.id, config);
    assert.equal(
      current.result.opportunities[0].currentEligibility.eligible,
      false,
    );
    await assert.rejects(
      reviewOpportunity(db, p, job.id, product.id, {
        decision: "qualified",
        answers: [],
        note: "",
      }),
      /eligible|inventory/i,
    );
  } finally {
    db.close();
  }
});
test("cancellation and interrupted leases never publish or silently repeat chargeable work", async () => {
  const { db, p, product } = await setup();
  try {
    const job = await createResearch(
      db,
      p,
      { name: "Example Manufacturing" },
      config,
    );
    let matchCalls = 0;
    await processResearch(db, job.id, config, {
      research: async () => {
        await cancelResearch(db, p, job.id);
        return artifact;
      },
      match: async () => {
        matchCalls++;
        return {
          report: validateMatches(report(product.id), artifact, [product]),
          usage: artifact.usage,
        };
      },
    });
    assert.equal(matchCalls, 0);
    assert.equal(
      (await getResearch(db, p, job.id, config)).status,
      "cancelled",
    );
    const interrupted = await createResearch(
      db,
      p,
      { name: "Second Manufacturer" },
      config,
    );
    await db.run(
      "UPDATE research_jobs SET status='running',phase='research_call',lease_until=1 WHERE id=?",
      interrupted.id,
    );
    await recoverInterrupted(db);
    assert.equal(
      (await getResearch(db, p, interrupted.id, config)).status,
      "failed",
    );
    assert.match(
      (await getResearch(db, p, interrupted.id, config)).error,
      /interrupted|uncertain/i,
    );
  } finally {
    db.close();
  }
});
test("daily model cap prevents the next external call and records a visible failure", async () => {
  const { db, p } = await setup();
  try {
    let calls = 0;
    const job = await createResearch(
      db,
      p,
      { name: "Example Manufacturing" },
      config,
    );
    await processResearch(
      db,
      job.id,
      { ...config, dailyCalls: 1 },
      {
        research: async () => {
          calls++;
          return artifact;
        },
        match: async () => {
          calls++;
          throw Error("must not run");
        },
      },
    );
    assert.equal(calls, 1);
    const result = await getResearch(db, p, job.id, config);
    assert.equal(result.status, "failed");
    assert.match(result.error, /daily/i);
  } finally {
    db.close();
  }
});
test("expired matching leases cannot publish and qualification respects the configured inventory age", async () => {
  const { db, p, product } = await setup();
  try {
    const job = await createResearch(db, p, { name: "Lease Example" }, config);
    await processResearch(db, job.id, config, {
      research: async () => artifact,
      match: async () => {
        await db.run(
          "UPDATE research_jobs SET lease_until=1 WHERE id=?",
          job.id,
        );
        return {
          report: validateMatches(report(product.id), artifact, [product]),
          usage: artifact.usage,
        };
      },
    });
    assert.notEqual(
      (await getResearch(db, p, job.id, config)).status,
      "complete",
    );
    await recoverInterrupted(db);
    const second = await createResearch(db, p, { name: "Age Example" }, config);
    await processResearch(db, second.id, config, {
      research: async () => artifact,
      match: async () => ({
        report: validateMatches(report(product.id), artifact, [product]),
        usage: artifact.usage,
      }),
    });
    await db.run(
      "UPDATE inventory SET updated_at=? WHERE id=?",
      Date.now() - 3 * 86400000,
      product.id,
    );
    await assert.rejects(
      reviewOpportunity(
        db,
        p,
        second.id,
        product.id,
        { decision: "qualified", answers: ["Confirmed"], note: "Review" },
        1,
      ),
      /eligible/i,
    );
  } finally {
    db.close();
  }
});
test("request keys remain idempotent after a completed run and reject changed input", async () => {
  const { db, p, product } = await setup();
  try {
    const input = { name: "Retry Example", requestKey: "persistent-key" };
    const first = await createResearch(db, p, input, config);
    assert.equal(
      (
        await createResearch(
          db,
          p,
          { ...input, requestKey: "coalesced-key" },
          config,
        )
      ).id,
      first.id,
    );
    await processResearch(db, first.id, config, {
      research: async () => artifact,
      match: async () => ({
        report: validateMatches(report(product.id), artifact, [product]),
        usage: artifact.usage,
      }),
    });
    assert.equal((await createResearch(db, p, input, config)).id, first.id);
    assert.equal(
      (
        await createResearch(
          db,
          p,
          { ...input, requestKey: "coalesced-key" },
          config,
        )
      ).id,
      first.id,
    );
    await assert.rejects(
      createResearch(db, p, { ...input, name: "Different company" }, config),
      /key/i,
    );
  } finally {
    db.close();
  }
});
test("historical or undated evidence requires confirmation of the current process", async () => {
  const { db, p, product } = await setup();
  try {
    const old = report(product.id);
    old.findings[0].evidenceDate = "2004-10-08";
    assert.equal(evidenceCaution(old as any, ["S1"]), true);
    const job = await createResearch(
      db,
      p,
      { name: "Historical Example" },
      config,
    );
    await processResearch(db, job.id, config, {
      research: async () => artifact,
      match: async () => ({
        report: validateMatches(old, artifact, [product]),
        usage: artifact.usage,
      }),
    });
    const o = (await getResearch(db, p, job.id, config)).result
      .opportunities[0];
    assert.equal(o.evidenceCaution, true);
    assert.match(o.questions[0], /still used/);
    old.findings[0].evidenceDate = "2999-01-01";
    assert.throws(() => validateMatches(old, artifact, [product]), /date/i);
  } finally {
    db.close();
  }
});
