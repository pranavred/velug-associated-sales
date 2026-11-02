import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, job } from "../src/store.js";
import { saveVersion, safeURL, parse } from "../src/collect.js";
import { validateProfile } from "../src/agents.js";
import { plants } from "../src/seeds.js";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "plant-test-"));
  const s = new Store(dir);
  s.seed();
  return {
    s,
    cleanup: () => {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("unchanged source is idempotent; changes append versions; failure preserves last good evidence", async () => {
  const { s, cleanup } = setup();
  try {
    const source = s.get("SELECT * FROM sources LIMIT 1");
    const seg = [{ locator: "p1", text: "NY0004189 test evidence" }];
    assert.equal(
      saveVersion(s, source, seg, Buffer.from("a"), source.url),
      true,
    );
    assert.equal(
      saveVersion(s, source, seg, Buffer.from("a"), source.url),
      false,
    );
    assert.equal(s.get("SELECT COUNT(*) n FROM versions").n, 1);
    saveVersion(
      s,
      source,
      [{ locator: "p1", text: "NY0004189 changed evidence" }],
      Buffer.from("b"),
      source.url,
    );
    assert.equal(s.get("SELECT COUNT(*) n FROM versions").n, 2);
    const version = s.get(
      "SELECT version FROM sources WHERE id=?",
      source.id,
    ).version;
    await assert.rejects(
      job(s, "collect:" + source.id, 24, async () => {
        throw new Error("HTTP 503");
      }),
    );
    assert.equal(
      s.get("SELECT version FROM sources WHERE id=?", source.id).version,
      version,
    );
    assert.equal(s.get("SELECT failures FROM jobs").failures, 1);
    assert.ok(s.get("SELECT next_at FROM jobs").next_at > Date.now());
  } finally {
    cleanup();
  }
});
test("lease blocks overlap even with force; survives restart; expired lease is recoverable", () => {
  const { s, cleanup } = setup();
  try {
    const now = Date.now(),
      token = s.claim("a", now);
    assert.ok(token);
    assert.equal(s.claim("a", now, true), null);
    const second = new Store(s.dir);
    assert.equal(second.claim("a", now), null);
    second.close();
    assert.ok(s.claim("a", now + 120001));
    s.finish("a", token!, 24);
    assert.equal(s.get("SELECT status FROM jobs").status, "running");
  } finally {
    cleanup();
  }
});
const evidence = [
  {
    source_id: "S1",
    url: "https://example.com",
    version: "v1",
    segments: [
      {
        locator: "page 1",
        text: "NY0004189: wastewater treatment is described in this historical permit.",
      },
    ],
  },
];
const base = {
  id: "C1",
  statement: "Wastewater treatment described",
  source_id: "S1",
  locator: "page 1",
  quote: evidence[0].segments[0].text,
  site_match: "exact_identifier" as const,
  classification: "reported_fact" as const,
  temporal_scope: "Historical; current operation unverified",
};
const profile = (c: any) => ({
  claims: [c],
  hypotheses: [
    {
      question: "Investigate treatment?",
      claim_ids: ["C1"],
      missing_evidence: ["Current program"],
    },
  ],
  unknowns: ["publication date"],
});
test("unsupported quotes, wrong-site and boilerplate claims are rejected, with dependent hypotheses", () => {
  for (const c of [
    { ...base, quote: "fabricated chemical purchases" },
    { ...base, site_match: "wrong_site" },
    { ...base, classification: "regulatory_boilerplate" },
    { ...base, locator: "page 2" },
  ]) {
    const r = validateProfile(profile(c), evidence, plants[0]);
    assert.equal(r.claims.length, 0);
    assert.equal(r.hypotheses.length, 0);
    assert.equal(r.rejected.length, 1);
  }
});
test("exact match requires quoted site identifier; accepted claims remain review pending", () => {
  assert.equal(
    validateProfile(profile(base), evidence, plants[1]).claims.length,
    0,
  );
  const r = validateProfile(profile(base), evidence, plants[0]);
  assert.equal(r.claims[0].review_status, "human_review_pending");
  assert.match(r.publication_dates, /Unknown/);
});
test("Yonkers hold and closure announcement suppress prospecting without claiming confirmed closure", () => {
  assert.equal(
    validateProfile(
      profile({ ...base, site_match: "locality_only" }),
      evidence,
      plants[4],
    ).prospect_status,
    "suppressed_pending_review",
  );
  assert.equal(
    validateProfile(
      profile({ ...base, classification: "closure_announcement" }),
      evidence,
      plants[0],
    ).prospect_status,
    "suppressed_pending_review",
  );
});
test("collector only allows configured HTTPS publisher hosts", () => {
  for (const u of [
    "http://127.0.0.1",
    "https://localhost",
    "https://example.com",
    "https://user@extapps.dec.ny.gov",
    "https://extapps.dec.ny.gov:4430/a",
  ])
    assert.throws(() => safeURL(u));
  assert.equal(
    safeURL("https://extapps.dec.ny.gov/a").hostname,
    "extapps.dec.ny.gov",
  );
});
test("age-gated content is a visible failure, not source evidence", async () => {
  await assert.rejects(
    parse(
      Buffer.from(
        "<html><body>Please verify your age. " +
          "date of birth ".repeat(25) +
          "</body></html>",
      ),
      "text/html",
    ),
    /gate/,
  );
});

test("dashboard serves valid JavaScript and isolated state", async () => {
  const { s, cleanup } = setup();
  const { serve } = await import("../src/dashboard.js");
  const { Script } = await import("node:vm");
  const server = serve(s, "demo", 0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    const html = await (await fetch(url)).text();
    const script = html.split("<script>")[1].split("</script>")[0];
    assert.doesNotThrow(() => new Script(script));
    const state = (await (await fetch(url + "/api/state")).json()) as any;
    assert.equal(state.mode, "demo");
    assert.equal(state.plants.length, 5);
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    cleanup();
  }
});

test("Anthropic discovery rejects partial turns, tool errors and no-search responses", async () => {
  const { searchCitations } = await import("../src/agents.js");
  assert.throws(
    () => searchCitations({ stop_reason: "pause_turn", content: [] } as any),
    /Incomplete/,
  );
  assert.throws(
    () => searchCitations({ stop_reason: "end_turn", content: [] } as any),
    /without executing/,
  );
  assert.throws(
    () =>
      searchCitations({
        stop_reason: "end_turn",
        content: [
          {
            type: "web_search_tool_result",
            content: { error_code: "max_uses_exceeded" },
          },
        ],
      } as any),
    /Web search failed/,
  );
  assert.deepEqual(
    searchCitations({
      stop_reason: "end_turn",
      content: [
        { type: "web_search_tool_result", content: [] },
        {
          type: "text",
          text: "Result",
          citations: [
            {
              type: "web_search_result_location",
              url: "https://example.com",
              title: null,
            },
          ],
        },
      ],
    } as any),
    [{ url: "https://example.com", title: "https://example.com" }],
  );
});
