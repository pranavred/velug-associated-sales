import type { IncomingMessage, ServerResponse } from "node:http";
import { Store } from "./store.js";
import { diffSegments } from "./evaluation.js";
export function recentChanges(store: Store) {
  return store
    .all("SELECT * FROM changes ORDER BY id DESC LIMIT 30")
    .map((c) => {
      const before = store.get(
        "SELECT segments FROM versions WHERE id=?",
        c.before_version,
      );
      const after = store.get(
        "SELECT segments FROM versions WHERE id=?",
        c.after_version,
      );
      return {
        ...c,
        diff:
          before && after
            ? diffSegments(
                JSON.parse(before.segments),
                JSON.parse(after.segments),
              )
            : [],
        note: "Text change only; operational significance awaits review",
      };
    });
}
export async function reviewRequest(
  store: Store,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  if (
    req.headers["x-review-token"] !== token ||
    req.headers.origin !== `http://${req.headers.host}`
  ) {
    res.writeHead(403);
    res.end("Local review token and same-origin request required");
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > 16000) throw new Error("Request too large");
    }
    const r = JSON.parse(body);
    for (const field of ["kind", "target", "decision", "reviewer", "note"])
      if (typeof r[field] !== "string")
        throw new Error("Review fields must be strings");
    store.review(r.kind, r.target, r.decision, r.reviewer, r.note);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(400);
    res.end(String(e));
  }
}
