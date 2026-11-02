import assert from "node:assert/strict";
import { getPlatformProxy } from "wrangler";
import { CloudDatabase } from "../app/d1-db.js";
import { schema } from "../app/schema.js";
import {
  bootstrap,
  signIn,
  sessionPrincipal,
  provisionCompany,
  activateInvite,
  inviteMember,
} from "../app/auth.js";
import { importInventory, listInventory } from "../app/inventory.js";
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: "wrangler.platform.example.jsonc",
  persist: false,
});
try {
  await proxy.env.DB.exec(schema);
  const db = new CloudDatabase(proxy.env.DB);
  await bootstrap(db, {
    email: "d1-owner@example.test",
    password: "long d1 test owner passphrase",
    company: "D1 seller",
  });
  const p = (await sessionPrincipal(
    db,
    (await signIn(db, "d1-owner@example.test", "long d1 test owner passphrase"))
      .token,
  ))!;
  await assert.rejects(
    db.batch([
      {
        sql: "INSERT INTO companies VALUES (?,?,?)",
        args: ["rollback", "Rollback", 1],
      },
      {
        sql: "INSERT INTO companies VALUES (?,?,?)",
        args: ["rollback", "Duplicate", 1],
      },
    ]),
  );
  assert.equal(
    await db.get("SELECT * FROM companies WHERE id=?", "rollback"),
    undefined,
  );
  const input = {
    source: "erp",
    key: "retry",
    mode: "replace" as const,
    rows: [{ sku: "A", name: "Filter", quantity: 4 }],
  };
  const receipts = await Promise.all([
    importInventory(db, p, input),
    importInventory(db, p, input),
  ]);
  assert.equal(receipts[0].id, receipts[1].id);
  assert.equal((await listInventory(db, p)).length, 1);
  const invite = await provisionCompany(
    db,
    p,
    "Other seller",
    "other@example.test",
  );
  await activateInvite(db, invite.token, "long d1 other owner passphrase");
  const other = (await sessionPrincipal(
    db,
    (await signIn(db, "other@example.test", "long d1 other owner passphrase"))
      .token,
  ))!;
  assert.equal((await listInventory(db, other)).length, 0);
  const member = await inviteMember(db, p, "member@example.test");
  const activations = await Promise.allSettled([
    activateInvite(db, member.token, "long d1 member passphrase"),
    activateInvite(db, member.token, "long d1 member passphrase"),
  ]);
  assert.equal(activations.filter((x) => x.status === "fulfilled").length, 1);
  console.log(
    "D1 parity passed: bootstrap, passwords, tenant isolation, concurrent imports/invites, atomic rollback.",
  );
} finally {
  await proxy.dispose();
}
