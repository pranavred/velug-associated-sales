import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { NodeDatabase } from "./node-db.js";
import { configuration } from "./config.js";
import { createHandler } from "./http.js";
import { processResearch, recoverInterrupted } from "./jobs.js";
import { bootstrap } from "./auth.js";
export async function startServer(env = process.env) {
  const config = configuration(env),
    db = new NodeDatabase(env.DATABASE_PATH || "data/platform.sqlite");
  if (
    env.BOOTSTRAP_EMAIL &&
    env.BOOTSTRAP_PASSWORD &&
    !(await db.get("SELECT 1 FROM app_state WHERE key='initialized'"))
  )
    await bootstrap(db, {
      email: env.BOOTSTRAP_EMAIL,
      password: env.BOOTSTRAP_PASSWORD,
      company: env.BOOTSTRAP_COMPANY || "My company",
    });
  const publicDir = fileURLToPath(new URL("./public/", import.meta.url));
  const active = new Set<string>();
  let stopping = false;
  const enqueue = async (id: string) => {
    if (active.has(id) || active.size >= 2 || stopping) return;
    active.add(id);
    void processResearch(db, id, config)
      .catch(() => console.error("Research processor failed"))
      .finally(() => active.delete(id));
  };
  const asset = async (path: string) => {
    const name = path.replace(/^\/assets\//, "").replace(/^\//, "");
    try {
      const data = await readFile(resolve(publicDir, name));
      return new Response(data, {
        headers: {
          "content-type": name.endsWith(".html")
            ? "text/html; charset=utf-8"
            : name.endsWith(".css")
              ? "text/css; charset=utf-8"
              : name.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : name.endsWith(".csv")
                  ? "text/csv; charset=utf-8"
                  : name.endsWith(".txt")
                    ? "text/plain; charset=utf-8"
                    : "font/woff2",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  };
  const handle = createHandler({ db, config, asset, enqueue });
  const server = createServer(async (req, res) => {
    try {
      const request = new Request(config.origin + (req.url || "/"), {
        method: req.method,
        headers: req.headers as HeadersInit,
        ...(["GET", "HEAD"].includes(req.method || "GET")
          ? {}
          : { body: Readable.toWeb(req) as ReadableStream, duplex: "half" }),
      } as RequestInit);
      const response = await handle(
        request,
        req.socket.remoteAddress || "unknown",
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body as any).pipe(res);
      else res.end();
    } catch {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"Request failed"}');
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const tick = async () => {
    if (stopping) return;
    try {
      await recoverInterrupted(db);
      for (const row of await db.all(
        "SELECT id FROM research_jobs WHERE status='queued' ORDER BY created_at LIMIT 2",
      ))
        await enqueue(row.id);
    } catch {
      console.error("Research queue check failed");
    }
  };
  const timer = setInterval(() => void tick(), 5000);
  timer.unref();
  await tick();
  await new Promise<void>((resolve) =>
    server.listen(Number(env.PORT || 4319), env.HOST || "127.0.0.1", resolve),
  );
  const stop = async () => {
    stopping = true;
    clearInterval(timer);
    server.close();
    const deadline = Date.now() + 20000;
    while (active.size && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    if (!active.size) db.close();
  };
  return { server, db, stop, config };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const runtime = await startServer();
  console.log(
    `Associated Sales: ${runtime.config.origin}${runtime.config.basePath}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(
      signal,
      () => void runtime.stop().finally(() => process.exit(0)),
    );
}
