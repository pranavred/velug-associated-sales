import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./store.js";
import { evaluate, diffSegments } from "./evaluation.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  command = args[0];
const flag = (name: string, fallback: string) => {
  const i = args.indexOf("--" + name);
  return i < 0 ? fallback : args[i + 1];
};
const mode = flag("mode", command === "diff" ? "demo" : "live");
if (!["demo", "live"].includes(mode)) throw new Error("Unknown mode");
const store = new Store(join(root, "data", mode));
const out = join(root, "data", mode, "reports");
mkdirSync(out, { recursive: true });
try {
  if (command === "evaluate") {
    const row = store.get(
      "SELECT * FROM profiles WHERE plant=? ORDER BY id DESC LIMIT 1",
      "PLANT-001",
    );
    if (!row) throw new Error("No Chobani profile to evaluate");
    const profile = JSON.parse(row.json);
    // Load immutable versions cited by the profile, not whatever sources happen to be latest.
    const evidence = store
      .all(
        "SELECT v.id,v.source,v.segments,s.url FROM versions v JOIN sources s ON s.id=v.source WHERE s.plant=?",
        "PLANT-001",
      )
      .map((r) => ({
        source_id: r.source,
        version: r.id,
        url: r.url,
        segments: JSON.parse(r.segments),
      }));
    const worksheet = {
      profile_id: row.id,
      fingerprint: row.fingerprint,
      origin: profile.mode,
      reviewer: "",
      judgments: profile.claims.map((c: any) => ({
        claim_id: c.id,
        supported: null,
        wrong_site: null,
        unsupported_chemical_assertion: null,
        reference_ids: [],
      })),
    };
    const reviewPath = flag("review", "");
    let review = worksheet;
    if (reviewPath) {
      review = z
        .object({
          profile_id: z.number(),
          fingerprint: z.string(),
          origin: z.string(),
          reviewer: z.string().min(1),
          judgments: z.array(
            z.object({
              claim_id: z.string(),
              supported: z.boolean().nullable(),
              wrong_site: z.boolean().nullable(),
              unsupported_chemical_assertion: z.boolean().nullable(),
              reference_ids: z.array(z.string()),
            }),
          ),
        })
        .parse(JSON.parse(readFileSync(reviewPath, "utf8")));
      if (
        review.fingerprint !== row.fingerprint ||
        review.profile_id !== row.id ||
        review.origin !== profile.mode
      )
        throw new Error(
          "Review does not match latest profile; regenerate worksheet",
        );
    }
    const result = {
      origin: profile.mode,
      profile_id: row.id,
      fingerprint: row.fingerprint,
      reviewer: review.reviewer || null,
      ...evaluate(profile, evidence, review.judgments),
    };
    const report = join(out, "evaluation.json");
    writeFileSync(report, JSON.stringify(result, null, 2) + "\n");
    // Never overwrite a worksheet the user may have annotated.
    const worksheetPath = join(out, `review-profile-${row.id}.json`);
    try {
      writeFileSync(worksheetPath, JSON.stringify(worksheet, null, 2) + "\n", {
        flag: "wx",
      });
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
    }
    console.log(JSON.stringify(result, null, 2));
    console.log(`Report: ${report}\nReview worksheet: ${worksheetPath}`);
  } else if (command === "diff") {
    const source = flag("source", "SRC-001");
    const versions = store.all(
      "SELECT rowid,* FROM versions WHERE source=? ORDER BY rowid DESC LIMIT 2",
      source,
    );
    if (versions.length < 2)
      throw new Error(
        "Need two saved versions; no change is invented for a live source",
      );
    const [after, before] = versions;
    const changes = diffSegments(
      JSON.parse(before.segments),
      JSON.parse(after.segments),
    );
    const report = {
      mode,
      source,
      comparison:
        "Two most recently stored distinct versions; not necessarily the last fetch transition",
      before: before.id,
      after: after.id,
      changes,
      interpretation:
        "Text changes require semantic review. They do not establish a business event or buying intent.",
    };
    const path = join(out, `diff-${source}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    console.log(`Report: ${path}`);
  } else throw new Error("Use evaluate or diff");
} finally {
  store.close();
}
