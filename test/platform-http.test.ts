import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeDatabase } from "../app/node-db.js";
import {
  bootstrap,
  signIn,
  sessionPrincipal,
  provisionCompany,
  activateInvite,
} from "../app/auth.js";
import { createInventoryToken } from "../app/inventory.js";
import { configuration } from "../app/config.js";
import { createHandler } from "../app/http.js";
const origin = "https://sales.example.com";
async function setup(basePath = "/associated-sales") {
  const db = new NodeDatabase(":memory:");
  await bootstrap(db, {
    email: "owner@example.test",
    password: "long owner test password",
    company: "Seller A",
  });
  const login = await signIn(
    db,
    "owner@example.test",
    "long owner test password",
  );
  const p = (await sessionPrincipal(db, login.token))!;
  const config = configuration({
    PUBLIC_ORIGIN: origin,
    BASE_PATH: basePath,
    OPENAI_API_KEY: "never-send-to-browser",
  });
  const handle = createHandler({
    db,
    config,
    asset: async (path) =>
      new Response(
        path === "/index.html" ? "<html>__BASE_PATH__</html>" : "asset",
      ),
    enqueue: async () => {},
  });
  const call = async (
    path: string,
    body?: unknown,
    options: {
      token?: string;
      cookie?: string;
      origin?: string;
      method?: string;
      companyId?: string;
    } = {},
  ) =>
    handle(
      new Request(origin + basePath + path, {
        method: options.method || (body === undefined ? "GET" : "POST"),
        headers: {
          "x-associated-sales-company":
            options.companyId ??
            (await sessionPrincipal(db, options.cookie ?? login.token))
              ?.companyId ??
            "",
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                origin: options.origin ?? origin,
              }),
          ...(options.token
            ? { authorization: "Bearer " + options.token }
            : { cookie: "as_session=" + (options.cookie ?? login.token) }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      "test-client",
    );
  return { db, p, login, config, handle, call };
}
test("prefix paths, cookies and browser writes stay on the configured origin", async () => {
  const s = await setup();
  try {
    assert.equal(
      (await s.handle(new Request(origin + "/api/session"), "ip")).status,
      404,
    );
    assert.match(
      await (await s.call("/research/abc")).text(),
      /associated-sales/,
    );
    assert.equal((await s.call("/assets/workspace.js")).status, 200);
    assert.equal(
      (await s.call("/api/session", undefined, { cookie: "forged" })).status,
      401,
    );
    const login = await s.call("/api/login", {
      email: "owner@example.test",
      password: "long owner test password",
    });
    assert.equal(login.status, 200);
    assert.match(
      login.headers.get("set-cookie")!,
      /Path=\/associated-sales;.*HttpOnly.*Secure/,
    );
    assert(!JSON.stringify(await login.json()).includes("never-send"));
    assert.equal(
      (await s.call("/api/logout", {}, { origin: "https://evil.example" }))
        .status,
      403,
    );
    const missing = await s.handle(
      new Request(origin + "/associated-sales/api/logout", {
        method: "POST",
        headers: {
          cookie: "as_session=" + s.login.token,
          "content-type": "application/json",
        },
        body: "{}",
      }),
      "ip",
    );
    assert.equal(missing.status, 403);
    const logout = await s.call("/api/logout", {});
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal((await s.call("/api/session")).status, 401);
  } finally {
    s.db.close();
  }
});
test("root hosting works and invalid/oversized bodies fail before mutation", async () => {
  const s = await setup("");
  try {
    assert.equal((await s.call("/inventory")).status, 200);
    const tooBig = await s.call("/api/inventory/import", {
      source: "erp",
      rows: ["x".repeat(2100000)],
    });
    assert.equal(tooBig.status, 413);
    const bad = await s.handle(
      new Request(origin + "/api/login", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{",
      }),
      "ip",
    );
    assert.equal(bad.status, 400);
    assert.equal((await s.call("/api/not-real")).status, 404);
  } finally {
    s.db.close();
  }
});
test("integration tokens can only import into their assigned source, never read tenant data", async () => {
  const s = await setup();
  try {
    const { token } = await createInventoryToken(s.db, s.p, "erp", "ERP sync");
    const input = {
      source: "erp",
      key: "one",
      mode: "upsert",
      rows: [{ sku: "P1", name: "Filter", quantity: 5 }],
    };
    const res = await s.call("/api/inventory/import", input, {
      token,
      origin: "https://external.example",
    });
    assert.equal(res.status, 200);
    assert.equal(
      (
        await s.call(
          "/api/inventory/import",
          { ...input, source: "other" },
          { token },
        )
      ).status,
      403,
    );
    for (const path of [
      "/api/session",
      "/api/inventory",
      "/api/team",
      "/api/research",
    ])
      assert.equal(
        (await s.call(path, undefined, { token })).status,
        403,
        path,
      );
    assert.equal(
      (
        await s.call(
          "/api/research",
          { name: "Example Manufacturer" },
          { token },
        )
      ).status,
      403,
    );
    const products = (await (await s.call("/api/inventory")).json()) as any;
    assert.equal(products.products.length, 1);
  } finally {
    s.db.close();
  }
});
test("HTTP tenant boundaries hide inventory, jobs, team and integration ids", async () => {
  const s = await setup();
  try {
    await s.call("/api/inventory/import", {
      source: "erp",
      key: "one",
      mode: "upsert",
      rows: [{ sku: "A", name: "Private product" }],
    });
    const token = await createInventoryToken(s.db, s.p, "erp", "Private token");
    const invite = await provisionCompany(
      s.db,
      s.p,
      "Seller B",
      "b@example.test",
    );
    await activateInvite(s.db, invite.token, "long company b test passphrase");
    const other = (
      await signIn(s.db, "b@example.test", "long company b test passphrase")
    ).token;
    assert.equal(
      (
        (await (
          await s.call("/api/inventory", undefined, { cookie: other })
        ).json()) as any
      ).products.length,
      0,
    );
    assert.equal(
      (
        await s.call(
          "/api/tokens/" + token.id,
          {},
          { cookie: other, method: "DELETE" },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await s.call(
          "/api/team/" + s.p.userId,
          {},
          { cookie: other, method: "DELETE" },
        )
      ).status,
      404,
    );
    const job = (await (
      await s.call("/api/research", {
        name: "Test Manufacturer",
        requestKey: "test-request",
      })
    ).json()) as any;
    assert.equal(
      (await s.call("/api/research/" + job.id, undefined, { cookie: other }))
        .status,
      404,
    );
    assert.equal(
      (await s.call("/api/company", { id: s.p.companyId }, { cookie: other }))
        .status,
      403,
    );
  } finally {
    s.db.close();
  }
});
test("stale browser tabs cannot write into a newly selected company", async () => {
  const s = await setup();
  try {
    const other = await provisionCompany(s.db, s.p, "Other seller", s.p.email);
    await activateInvite(s.db, other.token, "long owner test password");
    await s.call("/api/company", { id: other.companyId });
    assert.equal(
      (
        await s.call("/api/inventory/import", {
          source: "erp",
          key: "b",
          mode: "replace",
          rows: [{ sku: "B", name: "B product" }],
        })
      ).status,
      200,
    );
    const stale = await s.call(
      "/api/inventory/import",
      {
        source: "erp",
        key: "a",
        mode: "replace",
        rows: [{ sku: "A-PRIVATE", name: "A product" }],
      },
      { companyId: s.p.companyId },
    );
    assert.equal(stale.status, 409);
    const result = (await (await s.call("/api/inventory")).json()) as any;
    assert.equal(result.products[0].sku, "B");
  } finally {
    s.db.close();
  }
});
