import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { saveVersion } from "../src/collect.js";
import { serve } from "../src/dashboard.js";
test("evidence keeps old versions accessible, escapes source HTML, and searches latest text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-test-"));
  const store = new Store(dir);
  store.seed();
  const source = store.get("SELECT * FROM sources LIMIT 1");
  saveVersion(
    store,
    source,
    [
      {
        locator: "PDF physical page 3",
        text: "old chlorine <script>alert(1)</script>",
      },
    ],
    Buffer.from("original bytes"),
    source.url,
  );
  const old = store.get(
    "SELECT version FROM sources WHERE id=?",
    source.id,
  ).version;
  saveVersion(
    store,
    source,
    [{ locator: "PDF physical page 3", text: "new boiler evidence" }],
    Buffer.from("new bytes"),
    source.url,
  );
  const server = serve(store, "live", 0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}`;
    const r = await fetch(
      `${base}/evidence/${old}?locator=PDF%20physical%20page%203`,
    );
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.match(html, /old chlorine/);
    assert.ok(!html.includes("<script>alert"));
    assert.match(html, /#page=3/);
    assert.equal(
      await (await fetch(`${base}/evidence/${old}/file`)).text(),
      "original bytes",
    );
    const search = (await (
      await fetch(base + "/api/search?q=boiler")
    ).json()) as any;
    assert.equal(search.hits.length, 1);
    assert.match(search.hits[0].excerpt, /new boiler/);
    assert.equal(
      ((await (await fetch(base + "/api/search?q=chlorine")).json()) as any)
        .hits.length,
      0,
    );
    assert.equal(
      (await fetch(base + "/evidence/" + "0".repeat(64))).status,
      404,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
