import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { saveVersion } from "../src/collect.js";
import { synthesize } from "../src/agents.js";
import { plants } from "../src/seeds.js";
test("Anthropic adapter sends structured schema, saves parsed evidence, and skips unchanged synthesis", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anthropic-test-")),
    store = new Store(dir);
  store.seed();
  try {
    const source = store.get("SELECT * FROM sources WHERE id='SRC-001'");
    const quote = "NY0004189: a synthetic process-water test fixture.";
    saveVersion(
      store,
      source,
      [{ locator: "p1", text: quote }],
      Buffer.from(quote),
      source.url,
    );
    let calls = 0;
    const api = new Anthropic({
      apiKey: "test-only",
      maxRetries: 0,
      fetch: async (_input, init) => {
        calls++;
        const body = JSON.parse(init!.body as string);
        assert.equal(body.output_config.format.type, "json_schema");
        assert.equal(body.max_tokens, 6000);
        return new Response(
          JSON.stringify({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "mock-claude",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  claims: [
                    {
                      id: "A",
                      statement: "Synthetic test fixture",
                      source_id: source.id,
                      locator: "p1",
                      quote,
                      site_match: "exact_identifier",
                      classification: "reported_fact",
                      temporal_scope: "synthetic",
                    },
                  ],
                  hypotheses: [],
                  unknowns: ["test only"],
                }),
              },
            ],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    });
    await synthesize(store, plants[0], api);
    await synthesize(store, plants[0], api);
    assert.equal(calls, 1);
    const profile = JSON.parse(store.get("SELECT json FROM profiles").json);
    assert.equal(profile.provider, "anthropic");
    assert.equal(
      profile.claims[0].version,
      store.get("SELECT version FROM sources WHERE id=?", source.id).version,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
