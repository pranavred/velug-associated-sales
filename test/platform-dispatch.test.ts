import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeDatabase } from "../app/node-db.js";
import { bootstrap, signIn, sessionPrincipal } from "../app/auth.js";
import { configuration } from "../app/config.js";
import { createResearch } from "../app/jobs.js";
import { dispatchResearch, reconcileQueued } from "../app/dispatch.js";
test("cloud reconciliation recovers queued delivery gaps without replaying terminal workflows", async () => {
  const db = new NodeDatabase(":memory:");
  try {
    await bootstrap(db, {
      email: "queue@example.test",
      password: "long queue test password",
      company: "Seller",
    });
    const p = (await sessionPrincipal(
      db,
      (await signIn(db, "queue@example.test", "long queue test password"))
        .token,
    ))!;
    const config = configuration({ OPENAI_API_KEY: "fixture" });
    const job = await createResearch(db, p, { name: "Queued company" }, config);
    await db.run("UPDATE research_jobs SET created_at=1 WHERE id=?", job.id);
    const delivered: string[] = [];
    await reconcileQueued(db, {
      create: async ({ id }) => {
        delivered.push(id);
      },
      get: async () => {
        throw Error("missing");
      },
    });
    assert.deepEqual(delivered, [job.id]);
    await dispatchResearch(db, job.id, {
      create: async () => {
        throw Error("exists");
      },
      get: async () => ({ status: async () => ({ status: "complete" }) }),
    });
    assert.equal(
      (await db.get("SELECT status FROM research_jobs WHERE id=?", job.id))!
        .status,
      "failed",
    );
    await reconcileQueued(db, {
      create: async () => {
        throw Error("must not run");
      },
      get: async () => {
        throw Error("must not run");
      },
    });
  } finally {
    db.close();
  }
});
