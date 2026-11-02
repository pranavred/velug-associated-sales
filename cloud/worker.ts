import { plantMedia, photoFiles } from "../src/plant-media";
import { plantOverviews } from "../src/plant-overview";
import font from "../assets/manrope.woff2";
import { chemicalLeads, confidenceModel } from "../src/chemical-leads";
import { dispatchResearch, type ResearchEnv } from "./research";
import { plantInput, sha } from "./research-core";
export { PlantResearch } from "./research";
import html from "../src/dashboard.html";
import { opportunities, brenntagFit } from "../src/opportunities";
import { diffSegments } from "../src/evaluation";
interface Env extends ResearchEnv {
  LIVE: D1Database;
  DEMO: D1Database;
  EVIDENCE: R2Bucket;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  PRIVATE_SITE?: string;
}
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const all = async (db: D1Database, sql: string, ...args: any[]) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all<any>()
  ).results;
async function signature(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function authenticated(req: Request, env: Env) {
  if (!env.SESSION_SECRET) return false;
  const cookie = req.headers
    .get("cookie")
    ?.match(/(?:^|; )session=([^;]+)/)?.[1];
  if (!cookie) return false;
  const [expires, sig] = cookie.split(".");
  return (
    Number(expires) > Date.now() &&
    Number(expires) < Date.now() + 86400001 &&
    sig === (await signature(env.SESSION_SECRET, expires))
  );
}
function login(message = "") {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Sign in</title><style>body{font:18px system-ui;max-width:400px;margin:15vh auto;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin:8px 0}</style><h1>Plant intelligence</h1><form method="post" action="/login"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Sign in</button></form><p>${escape(message)}</p>`,
    {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
async function state(db: D1Database, mode: string, canReview: boolean) {
  const [plantRows, sources, rows, reviews, jobs, events, budgets, changes] =
    await Promise.all([
      all(db, "SELECT * FROM plants"),
      all(db, "SELECT * FROM sources"),
      all(
        db,
        "SELECT * FROM profiles WHERE id IN (SELECT MAX(id) FROM profiles GROUP BY plant)",
      ),
      all(db, "SELECT * FROM reviews ORDER BY id DESC"),
      all(db, "SELECT * FROM jobs"),
      all(db, "SELECT * FROM events ORDER BY id DESC LIMIT 60"),
      all(db, "SELECT * FROM api_budget ORDER BY day DESC LIMIT 7"),
      all(db, "SELECT * FROM changes ORDER BY id DESC LIMIT 30"),
    ]);
  const plants = plantRows.map((r) => JSON.parse(r.json));
  const profiles = rows.map((r) => ({
    ...r,
    json: undefined,
    profile: JSON.parse(r.json),
  }));
  const latest = new Map();
  for (const r of reviews)
    if (!latest.has(r.target)) latest.set(r.target, r.decision);
  const potential_opportunities = profiles.flatMap((row) => {
    const p = plants.find((p) => p.id === row.plant);
    if (!p) return [];
    return opportunities(
      p,
      row.profile,
      row.profile.claims
        .filter((c: any) => latest.get(row.id + ":" + c.id) === "unsupported")
        .map((c: any) => c.id),
    ).map((o) => ({
      ...o,
      plant_id: row.plant,
      profile_id: row.id,
      seller_example: brenntagFit(o.id),
      evidence_freshness: o.plant_evidence.some(
        (e: any) =>
          sources.find((s) => s.id === e.source_id)?.version !== e.version,
      )
        ? "Supporting source changed; re-review needed"
        : "Check historical dates and current site status",
    }));
  });
  for (const c of changes) {
    const versions = await all(
      db,
      "SELECT id,segments FROM versions WHERE id IN (?,?)",
      c.before_version,
      c.after_version,
    );
    const before = versions.find((v) => v.id === c.before_version),
      after = versions.find((v) => v.id === c.after_version);
    c.diff =
      before && after
        ? diffSegments(JSON.parse(before.segments), JSON.parse(after.segments))
        : [];
    c.note = "Text change only; operational significance awaits review";
  }
  return {
    mode,
    can_review: canReview,
    review_token: "session",
    plants,
    sources,
    profiles,
    reviews,
    jobs,
    events,
    budgets,
    changes,
    potential_opportunities,
    chemical_leads: chemicalLeads(potential_opportunities, profiles, sources),
    confidence_model: confidenceModel,
    plant_overviews: plantOverviews(profiles, sources),
    plant_media: mode === "demo" ? [] : plantMedia,
  };
}
async function handler(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url),
    admin = await authenticated(req, env);
  if (url.pathname === "/login") {
    if (req.method === "GET") return login();
    if (req.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    if (req.headers.get("origin") !== url.origin)
      return new Response("Forbidden", { status: 403 });
    if (Number(req.headers.get("content-length") || 0) > 4096)
      return new Response("Too large", { status: 413 });
    const body = await req.text();
    if (body.length > 4096) return new Response("Too large", { status: 413 });
    const window = Math.floor(Date.now() / 900000);
    const client = await signature(
      env.SESSION_SECRET,
      req.headers.get("CF-Connecting-IP") || "local",
    );
    await env.LIVE.prepare("DELETE FROM auth_attempts WHERE window < ?")
      .bind(window - 1)
      .run();
    const attempts = await env.LIVE.prepare(
      "INSERT INTO auth_attempts(client,window,attempts) VALUES (?,?,1) ON CONFLICT(client,window) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
    )
      .bind(client, window)
      .first<{ attempts: number }>();
    if (!attempts || attempts.attempts > 10)
      return new Response(
        "Too many sign-in attempts. Try again in 15 minutes.",
        { status: 429, headers: { "Retry-After": "900" } },
      );
    if (
      !env.ADMIN_PASSWORD ||
      new URLSearchParams(body).get("password") !== env.ADMIN_PASSWORD
    )
      return login("Invalid password.");
    const expires = String(Date.now() + 86400000),
      cookie = expires + "." + (await signature(env.SESSION_SECRET, expires));
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": `session=${cookie}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`,
      },
    });
  }
  if (url.pathname === "/logout")
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie":
          "session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
      },
    });
  if (env.PRIVATE_SITE === "true" && !admin)
    return req.method === "GET"
      ? Response.redirect(url.origin + "/login", 302)
      : new Response("Unauthorized", { status: 401 });
  const demo = url.pathname === "/demo" || url.pathname.startsWith("/demo/");
  const prefix = demo ? "/demo" : "";
  const path = demo ? url.pathname.slice(5) || "/" : url.pathname;
  const db = demo ? env.DEMO : env.LIVE;
  const mode = demo ? "demo" : "live";
  if (path === "/api/research" && req.method === "POST" && !demo) {
    if (!admin || req.headers.get("origin") !== url.origin)
      return json({ error: "Sign in required" }, 403);
    const body = await req.text();
    if (body.length > 2048) return json({ error: "Request too large" }, 413);
    let input;
    try {
      input = plantInput(JSON.parse(body));
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Invalid request" },
        400,
      );
    }
    const plant =
      "PLANT-" +
      (await sha((input.name + "|" + input.location).toLowerCase())).slice(
        0,
        16,
      );
    const active = await env.LIVE.prepare(
      "SELECT * FROM research_requests WHERE plant=? AND status IN ('awaiting_key','queued','discovering','collecting','synthesizing')",
    )
      .bind(plant)
      .first();
    if (active) return json({ request: active }, 200);
    const id = crypto.randomUUID(),
      now = new Date().toISOString(),
      status = env.ANTHROPIC_API_KEY ? "queued" : "awaiting_key";
    const facility = {
      id: plant,
      name: input.name,
      address: input.location,
      identity: [input.location],
      risk: "Facility supplied by user; evidence and attribution need review.",
      hold: false,
    };
    try {
      await env.LIVE.batch([
        env.LIVE.prepare(
          "INSERT OR IGNORE INTO plants(id,json) VALUES (?,?)",
        ).bind(plant, JSON.stringify(facility)),
        env.LIVE.prepare(
          "INSERT INTO research_requests(id,plant,name,location,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        ).bind(id, plant, input.name, input.location, status, now, now),
      ]);
    } catch {
      return json(
        { error: "An active request already exists. Refresh to view it." },
        409,
      );
    }
    if (env.ANTHROPIC_API_KEY) await dispatchResearch(env);
    return json({ request: { id, plant, ...input, status } }, 202);
  }
  if (req.method === "POST" && path === "/api/review") {
    if (
      !admin ||
      req.headers.get("origin") !== url.origin ||
      req.headers.get("x-review-token") !== "session"
    )
      return new Response("Sign in to review", { status: 403 });
    const text = await req.text();
    if (text.length > 16000) return new Response("Too large", { status: 413 });
    let r: any;
    try {
      r = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (
      !["kind", "target", "decision", "reviewer", "note"].every(
        (k) => typeof r[k] === "string",
      ) ||
      !r.reviewer.trim() ||
      !r.note.trim() ||
      r.reviewer.length > 120 ||
      r.note.length > 2000
    )
      return json({ error: "Reviewer and reason required" }, 400);
    if (r.kind === "claim") {
      const [id, cid] = r.target.split(":");
      const p = await db
        .prepare("SELECT json FROM profiles WHERE id=?")
        .bind(id)
        .first<any>();
      if (
        !p ||
        !JSON.parse(p.json).claims.some((c: any) => c.id === cid) ||
        !["supported", "unsupported", "uncertain"].includes(r.decision)
      )
        return json({ error: "Invalid claim review" }, 400);
    } else if (r.kind === "change") {
      if (
        !(await db
          .prepare("SELECT id FROM changes WHERE id=?")
          .bind(r.target)
          .first()) ||
        !["meaningful", "not_meaningful", "uncertain"].includes(r.decision)
      )
        return json({ error: "Invalid change review" }, 400);
    } else return json({ error: "Invalid review kind" }, 400);
    const at = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "INSERT INTO reviews(kind,target,decision,reviewer,note,at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          r.kind,
          r.target,
          r.decision,
          r.reviewer.trim(),
          r.note.trim(),
          at,
        ),
      db
        .prepare("INSERT INTO events(at,kind,subject,detail) VALUES (?,?,?,?)")
        .bind(
          at,
          "review_recorded",
          r.kind + ":" + r.target,
          r.decision + " by " + r.reviewer.trim(),
        ),
    ]);
    return json({ ok: true });
  }
  if (path.startsWith("/assets/plants/") && req.method === "GET") {
    const file = path.slice("/assets/plants/".length);
    if (!photoFiles.has(file))
      return new Response("Not found", { status: 404 });
    const object = await env.EVIDENCE.get("plant-media/" + file);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (path === "/assets/manrope.woff2" && req.method === "GET")
    return new Response(font, { headers: { "Content-Type": "font/woff2" } });
  if (req.method !== "GET")
    return new Response("Method not allowed", { status: 405 });
  if (path === "/") {
    let page = html
      .replaceAll('"/api/', '"' + prefix + "/api/")
      .replaceAll("'/api/", "'" + prefix + "/api/")
      .replaceAll('"/evidence/', '"' + prefix + "/evidence/")
      .replaceAll("'/evidence/", "'" + prefix + "/evidence/");
    page = page.replace(
      '<nav id="session-nav"></nav>',
      `<nav id="session-nav"><a href="${demo ? "/" : "/demo"}">${demo ? "Research" : "Synthetic demo"}</a><a href="${admin ? "/logout" : "/login"}">${admin ? "Sign out" : "Sign in"}</a></nav>`,
    );
    return new Response(page, {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  if (path === "/api/state") {
    const result = await state(db, mode, admin);
    return json({
      ...result,
      research: demo
        ? null
        : {
            enabled: !!env.ANTHROPIC_API_KEY,
            requests: await all(
              db,
              "SELECT * FROM research_requests ORDER BY created_at DESC LIMIT 30",
            ),
          },
    });
  }
  if (path === "/api/export") {
    const s = await state(db, mode, admin);
    const { review_token, can_review, ...rest } = s;
    return new Response(
      JSON.stringify(
        {
          ...rest,
          exported_at: new Date().toISOString(),
          profiles: (await all(db, "SELECT * FROM profiles")).map((r) => ({
            ...r,
            json: JSON.parse(r.json),
          })),
          versions: await all(
            db,
            "SELECT id,source,fetched_at,final_url FROM versions",
          ),
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition":
            'attachment; filename="plant-research-export.json"',
          "Cache-Control": "no-store",
        },
      },
    );
  }
  if (path === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200),
      hits: any[] = [];
    if (q.length >= 2) {
      const versions = await all(
        db,
        "SELECT v.*,s.title,s.plant FROM versions v JOIN sources s ON s.id=v.source WHERE s.version=v.id",
      );
      outer: for (const v of versions)
        for (const seg of JSON.parse(v.segments)) {
          const at = seg.text.toLowerCase().indexOf(q.toLowerCase());
          if (at < 0) continue;
          hits.push({
            source_id: v.source,
            plant: v.plant,
            title: v.title,
            locator: seg.locator,
            excerpt: seg.text.slice(Math.max(0, at - 100), at + 300),
            href: `${prefix}/evidence/${v.id}?locator=${encodeURIComponent(seg.locator)}`,
          });
          if (hits.length >= 30) break outer;
        }
    }
    return json({
      query: q,
      hits,
      note: "Latest saved documents; mentions are not proof of use.",
    });
  }
  const match = path.match(/^\/evidence\/([a-f0-9]{64})(\/file)?$/);
  if (match) {
    const v = await db
      .prepare(
        "SELECT v.*,s.title,s.url FROM versions v JOIN sources s ON s.id=v.source WHERE v.id=?",
      )
      .bind(match[1])
      .first<any>();
    if (!v) return new Response("Evidence not found", { status: 404 });
    if (match[2]) {
      const obj = await env.EVIDENCE.get(`${mode}/${v.id}`);
      if (!obj) return new Response("Saved file unavailable", { status: 404 });
      const type = obj.httpMetadata?.contentType || "application/octet-stream";
      return new Response(obj.body, {
        headers: {
          "Content-Type": type,
          "Content-Disposition": `${type === "application/pdf" ? "inline" : "attachment"}; filename="${v.source}-${v.id.slice(0, 12)}.${type === "application/pdf" ? "pdf" : "bin"}"`,
        },
      });
    }
    const locator = url.searchParams.get("locator"),
      segments = JSON.parse(v.segments),
      page = locator?.match(/^PDF physical page (\d+)$/)?.[1];
    const original = new URL(v.url);
    if (page) original.hash = "page=" + page;
    return new Response(
      `<!doctype html><meta name="viewport" content="width=device-width"><title>${escape(v.title)}</title><style>body{font:16px system-ui;max-width:950px;margin:auto;padding:24px;line-height:1.6}p{white-space:pre-wrap;overflow-wrap:anywhere}.selected{background:#fff0b5;padding:16px}a{margin-right:20px}</style><h1>${escape(v.title)}</h1><p>${mode === "demo" ? "SYNTHETIC EVIDENCE · " : ""}${escape(v.fetched_at)} · ${escape(v.id)}</p><a href="${escape(original.href)}" rel="noopener noreferrer" target="_blank">Open original source</a><a href="${prefix}/evidence/${v.id}/file">Saved file</a>${segments.map((s: any) => `<section${s.locator === locator ? ' id="selected" class="selected"' : ""}><h2>${escape(s.locator)}</h2><p>${escape(s.text)}</p></section>`).join("")}`,
      { headers: { "Content-Type": "text/html;charset=utf-8" } },
    );
  }
  return new Response("Not found", { status: 404 });
}
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatchResearch(env));
  },
  async fetch(req: Request, env: Env) {
    try {
      const response = await handler(req, env);
      const res = new Response(response.body, response);
      res.headers.set("Cache-Control", "private, no-store");
      res.headers.set("X-Content-Type-Options", "nosniff");
      res.headers.set("X-Frame-Options", "DENY");
      res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      return res;
    } catch (e) {
      console.error(
        "Request failed",
        e instanceof Error ? e.message : "Unknown error",
      );
      return json({ error: "Request failed" }, 500);
    }
  },
};
