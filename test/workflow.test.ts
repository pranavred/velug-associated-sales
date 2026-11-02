import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { saveVersion } from "../src/collect.js";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "workflow-"));
  const s = new Store(dir);
  s.seed();
  return {
    s,
    done: () => {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("persistent daily call cap is shared across connections and resets by UTC day", () => {
  const { s, done } = setup();
  try {
    assert.equal(s.reserveCall(2, "2026-10-23"), true);
    const other = new Store(s.dir);
    try {
      assert.equal(other.reserveCall(2, "2026-10-23"), true);
      assert.equal(s.reserveCall(2, "2026-10-23"), false);
      assert.equal(s.reserveCall(2, "2026-10-24"), true);
    } finally {
      other.close();
    }
  } finally {
    done();
  }
});
test("source transitions preserve reversions and unchanged fetches create no change", () => {
  const { s, done } = setup();
  try {
    const src = s.get("SELECT * FROM sources LIMIT 1");
    const save = (text: string) =>
      saveVersion(
        s,
        src,
        [{ locator: "p1", text }],
        Buffer.from(text),
        src.url,
      );
    save("a");
    save("b");
    save("b");
    save("a");
    const rows = s.all("SELECT * FROM changes ORDER BY id");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].before_version, rows[1].after_version);
    assert.equal(rows[0].after_version, rows[1].before_version);
  } finally {
    done();
  }
});
test("reviews are append-only, bound to real claims, and require a reviewer and reason", () => {
  const { s, done } = setup();
  try {
    s.run(
      "INSERT INTO profiles(plant,at,fingerprint,json) VALUES (?,?,?,?)",
      "PLANT-001",
      "now",
      "test",
      JSON.stringify({ claims: [{ id: "A" }] }),
    );
    assert.throws(
      () =>
        s.review("claim", "1:missing", "supported", "Pranav", "checked source"),
      /Unknown/,
    );
    assert.throws(
      () => s.review("claim", "1:A", "supported", "", "checked source"),
      /reviewer/,
    );
    s.review("claim", "1:A", "supported", "Pranav", "checked source");
    s.review(
      "claim",
      "1:A",
      "uncertain",
      "Pranav",
      "new contradictory evidence",
    );
    assert.equal(s.all("SELECT * FROM reviews").length, 2);
  } finally {
    done();
  }
});

test("review endpoint rejects other origins and missing tokens, then records a local review", async () => {
  const { s, done } = setup();
  s.run(
    "INSERT INTO profiles(plant,at,fingerprint,json) VALUES (?,?,?,?)",
    "PLANT-001",
    "now",
    "test",
    JSON.stringify({ claims: [{ id: "A" }] }),
  );
  const { serve } = await import("../src/dashboard.js");
  const server = serve(s, "demo", 0);
  try {
    await new Promise<void>((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const state = (await (await fetch(base + "/api/state")).json()) as any;
    const body = JSON.stringify({
      kind: "claim",
      target: "1:A",
      decision: "uncertain",
      reviewer: "Automated test",
      note: "Fixture only",
    });
    for (const headers of [
      { Origin: "https://example.com", "X-Review-Token": state.review_token },
      { Origin: base },
    ])
      assert.equal(
        (
          await fetch(base + "/api/review", {
            method: "POST",
            headers: headers as Record<string, string>,
            body,
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await fetch(base + "/api/review", {
          method: "POST",
          headers: { Origin: base, "X-Review-Token": state.review_token },
          body,
        })
      ).status,
      200,
    );
    assert.equal(s.all("SELECT * FROM reviews").length, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    done();
  }
});
