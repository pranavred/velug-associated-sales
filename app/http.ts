import { AppError, fail, text, type Sql } from "./db.js";
import {
  bootstrap,
  signIn,
  signOut,
  sessionPrincipal,
  switchCompany,
  inviteMember,
  activateInvite,
  revokeMember,
  provisionCompany,
  requireOwner,
  limit,
  digest,
  changePassword,
} from "./auth.js";
import {
  importInventory,
  listInventory,
  inventoryPrincipal,
  createInventoryToken,
  revokeInventoryToken,
} from "./inventory.js";
import {
  createResearch,
  getResearch,
  cancelResearch,
  reviewOpportunity,
  recoverInterrupted,
} from "./jobs.js";
import { parseCSV } from "./csv.js";
import type { Config } from "./config.js";
export type Runtime = {
  db: Sql;
  config: Config;
  asset: (path: string) => Promise<Response>;
  enqueue: (id: string) => Promise<void>;
};
const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(value, { status, headers });
async function body(request: Request, max = 2000000): Promise<any> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    fail(415, "Use application/json");
  if (Number(request.headers.get("content-length") || 0) > max)
    fail(413, "Request body is too large");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      fail(413, "Request body is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== "object" || Array.isArray(result))
      fail(400, "JSON object required");
    return result;
  } catch (e) {
    if (e instanceof AppError) throw e;
    fail(400, "Invalid JSON");
  }
}
export function createHandler({ db, config, asset, enqueue }: Runtime) {
  const cookie = (token: string, maxAge = 28800) =>
    `as_session=${token}; Path=${config.basePath || "/"}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.origin.startsWith("https:") ? "; Secure" : ""}`;
  return async (request: Request, client = "unknown"): Promise<Response> => {
    let response: Response;
    try {
      const url = new URL(request.url),
        base = config.basePath;
      if (base && url.pathname !== base && !url.pathname.startsWith(base + "/"))
        fail(404, "Not found");
      const path = url.pathname.slice(base.length) || "/",
        method = request.method;
      if (/%|\\/.test(path)) fail(404, "Not found");
      if (path === "/api/health" && method === "GET") return json({ ok: true });
      if (!path.startsWith("/api/")) {
        if (method !== "GET" && method !== "HEAD")
          fail(405, "Method not allowed");
        if (
          path.startsWith("/assets/") &&
          /^\/assets\/[a-zA-Z0-9._-]+$/.test(path)
        )
          response = await asset(path);
        else if (
          /^\/(?:login|activate|inventory|team|settings|research(?:\/[a-zA-Z0-9-]+)?)?\/?$/.test(
            path,
          )
        ) {
          const html = await asset("/index.html");
          response = new Response(
            (await html.text()).replaceAll("__BASE_PATH__", base),
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        } else fail(404, "Not found");
      } else {
        const token =
          request.headers
            .get("cookie")
            ?.split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith("as_session="))
            ?.slice(11) || "";
        const authorization = request.headers.get("authorization");
        const isIntegration = Boolean(authorization);
        // The only bearer-authorized operation is a source-scoped inventory write.
        if (
          isIntegration &&
          (path !== "/api/inventory/import" || method !== "POST")
        )
          fail(403, "Integration tokens may only import inventory");
        if (
          !["GET", "HEAD"].includes(method) &&
          !isIntegration &&
          request.headers.get("origin") !== config.origin
        )
          fail(403, "Same-origin request required");
        if (path === "/api/login" && method === "POST") {
          await limit(db, "login-ip:" + client, 30, 900000);
          const input = await body(request, 16000);
          await limit(
            db,
            "login-email:" + String(input.email).toLowerCase(),
            10,
            900000,
          );
          const result = await signIn(db, input.email, input.password);
          response = json({ companies: result.companies }, 200, {
            "set-cookie": cookie(result.token),
          });
        } else if (path === "/api/activate" && method === "POST") {
          await limit(db, "activate:" + client, 20, 900000);
          const input = await body(request, 16000);
          response = json(
            await activateInvite(db, input.token, input.password),
          );
        } else if (path === "/api/setup" && method === "POST") {
          await limit(db, "setup:" + client, 5, 900000);
          const input = await body(request, 16000);
          if (
            !config.setupToken ||
            typeof input.token !== "string" ||
            (await digest(input.token)) !== (await digest(config.setupToken))
          )
            fail(403, "Invalid setup token");
          response = json(await bootstrap(db, input), 201);
        } else {
          const p = isIntegration
            ? await inventoryPrincipal(
                db,
                authorization!.replace(/^Bearer /, ""),
              )
            : await sessionPrincipal(db, token);
          if (!p) fail(401, "Sign in to your company workspace");
          if (
            p.role !== "integration" &&
            ![
              "/api/session",
              "/api/logout",
              "/api/account/password",
              "/api/company",
            ].includes(path) &&
            request.headers.get("x-associated-sales-company") !== p.companyId
          )
            fail(
              409,
              "Company changed in another tab. Reload this workspace before continuing.",
            );
          await limit(
            db,
            "request:" + p.companyId + ":" + p.userId,
            300,
            60000,
          );
          const input =
            method === "GET" || method === "HEAD" ? {} : await body(request);
          if (path === "/api/session" && method === "GET") {
            const companies = await db.all(
              "SELECT c.id,c.name,m.role FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=? ORDER BY c.name",
              p.userId,
            );
            const usage = await db.get(
              "SELECT calls FROM budgets WHERE company_id=? AND day=?",
              p.companyId,
              new Date().toISOString().slice(0, 10),
            );
            response = json({
              user: p,
              companies,
              researchConfigured: Boolean(config.apiKey),
              limits: {
                dailyCalls: config.dailyCalls,
                usedCalls: usage?.calls || 0,
                staleDays: config.staleDays,
                maxCandidates: config.maxCandidates,
              },
            });
          } else if (path === "/api/logout" && method === "POST") {
            await signOut(db, token);
            response = json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
          } else if (path === "/api/account/password" && method === "POST") {
            await limit(db, "password:" + p.userId, 5, 900000);
            await changePassword(db, p, input.current, input.next);
            response = json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
          } else if (path === "/api/company" && method === "POST") {
            await switchCompany(db, token, text(input.id, "company ID"));
            response = json({ ok: true });
          } else if (path === "/api/companies" && method === "POST") {
            response = json(
              await provisionCompany(db, p, input.name, input.email),
              201,
            );
          } else if (path === "/api/inventory" && method === "GET") {
            const offset = Number(url.searchParams.get("offset") || 0);
            if (!Number.isSafeInteger(offset) || offset < 0)
              fail(400, "Invalid offset");
            response = json({
              products: await listInventory(db, p, 500, offset),
              total: (await db.get(
                "SELECT count(*) AS n FROM inventory WHERE company_id=?",
                p.companyId,
              ))!.n,
              offset,
            });
          } else if (path === "/api/inventory/preview" && method === "POST") {
            requireOwner(p);
            const rows =
              input.csv !== undefined
                ? parseCSV(text(input.csv, "CSV", 1900000))
                : input.rows;
            if (
              !Array.isArray(rows) ||
              !rows.length ||
              rows.length > 1000 ||
              !rows[0] ||
              typeof rows[0] !== "object"
            )
              fail(400, "Supply 1–1,000 inventory rows");
            response = json({
              headers: Object.keys(rows[0]),
              count: rows.length,
              sample: rows.slice(0, 3),
            });
          } else if (path === "/api/inventory/import" && method === "POST") {
            const rows =
              input.csv !== undefined
                ? parseCSV(text(input.csv, "CSV", 1900000))
                : input.rows;
            response = json(
              await importInventory(db, p, {
                ...input,
                rows,
                key: request.headers.get("idempotency-key") || input.key,
              }),
            );
          } else if (path === "/api/tokens" && method === "GET") {
            requireOwner(p);
            response = json(
              await db.all(
                "SELECT id,source,label,created_at AS createdAt,revoked_at AS revokedAt FROM integration_tokens WHERE company_id=? ORDER BY created_at DESC",
                p.companyId,
              ),
            );
          } else if (path === "/api/tokens" && method === "POST") {
            response = json(
              await createInventoryToken(db, p, input.source, input.label),
              201,
            );
          } else if (
            /^\/api\/tokens\/[^/]+$/.test(path) &&
            method === "DELETE"
          ) {
            await revokeInventoryToken(db, p, path.split("/").at(-1)!);
            response = json({ ok: true });
          } else if (path === "/api/team" && method === "GET") {
            requireOwner(p);
            response = json({
              members: await db.all(
                "SELECT u.id,u.email,m.role FROM memberships m JOIN users u ON m.user_id=u.id WHERE company_id=?",
                p.companyId,
              ),
              invites: await db.all(
                "SELECT id,email,role,expires_at AS expiresAt,used_at AS usedAt FROM invites WHERE company_id=? ORDER BY expires_at DESC LIMIT 100",
                p.companyId,
              ),
            });
          } else if (path === "/api/team" && method === "POST") {
            response = json(
              await inviteMember(db, p, input.email, input.role),
              201,
            );
          } else if (/^\/api\/team\/[^/]+$/.test(path) && method === "DELETE") {
            await revokeMember(db, p, path.split("/").at(-1)!);
            response = json({ ok: true });
          } else if (
            /^\/api\/invites\/[^/]+$/.test(path) &&
            method === "DELETE"
          ) {
            requireOwner(p);
            if (
              !(await db.run(
                "UPDATE invites SET expires_at=0 WHERE company_id=? AND id=? AND used_at IS NULL",
                p.companyId,
                path.split("/").at(-1)!,
              ))
            )
              fail(404, "Invitation not found");
            response = json({ ok: true });
          } else if (path === "/api/research" && method === "GET") {
            await recoverInterrupted(db);
            response = json(
              (
                await db.all(
                  "SELECT id,input,status,phase,error,created_at AS createdAt FROM research_jobs WHERE company_id=? ORDER BY created_at DESC LIMIT 100",
                  p.companyId,
                )
              ).map((r) => ({ ...r, input: JSON.parse(r.input) })),
            );
          } else if (path === "/api/research" && method === "POST") {
            await recoverInterrupted(db);
            const job = await createResearch(
              db,
              p,
              {
                ...input,
                requestKey: text(
                  request.headers.get("idempotency-key") || input.requestKey,
                  "request key",
                  120,
                ),
              },
              config,
            );
            try {
              if (job.status === "queued") await enqueue(job.id);
            } catch {
              await db.run(
                "UPDATE research_jobs SET status='failed',error='Could not schedule research. Start a new run.',updated_at=? WHERE id=? AND status='queued'",
                Date.now(),
                job.id,
              );
              fail(503, "Could not schedule research");
            }
            response = json(job, 202);
          } else if (
            /^\/api\/research\/[^/]+$/.test(path) &&
            method === "GET"
          ) {
            await recoverInterrupted(db);
            response = json(
              await getResearch(db, p, path.split("/").at(-1)!, config),
            );
          } else if (
            /^\/api\/research\/[^/]+\/cancel$/.test(path) &&
            method === "POST"
          ) {
            await cancelResearch(db, p, path.split("/")[3]);
            response = json({ ok: true });
          } else if (
            /^\/api\/research\/[^/]+\/reviews\/[^/]+$/.test(path) &&
            method === "POST"
          ) {
            await reviewOpportunity(
              db,
              p,
              path.split("/")[3],
              path.split("/")[5],
              input,
              config.staleDays,
            );
            response = json({ ok: true });
          } else if (path === "/api/audit" && method === "GET") {
            requireOwner(p);
            response = json(
              await db.all(
                "SELECT action,detail,created_at AS createdAt FROM audit_events WHERE company_id=? ORDER BY created_at DESC LIMIT 100",
                p.companyId,
              ),
            );
          } else fail(404, "Not found");
        }
      }
    } catch (e) {
      response = json(
        {
          error:
            e instanceof AppError
              ? e.message
              : "Request failed. Please try again.",
        },
        e instanceof AppError ? e.status : 500,
      );
    }
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    headers.set(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers,
    });
  };
}
