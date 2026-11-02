import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { Store, job } from "./store.js";
import { plants } from "./seeds.js";
import { collect, safeURL } from "./collect.js";
import { discover, synthesize } from "./agents.js";
import { demo } from "./demo.js";
import { serve } from "./dashboard.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const args = process.argv.slice(2),
  command = args[0] || "status";
function flag(name: string) {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : undefined;
}
const mode =
  flag("mode") || (command === "demo" || command === "serve" ? "demo" : "live");
if (!["live", "demo"].includes(mode))
  throw new Error("Mode must be live or demo");
if (
  ["collect", "discover", "synthesize", "tick", "worker", "approve"].includes(
    command,
  ) &&
  mode !== "live"
)
  throw new Error("Network/model jobs use live mode only");
const store = new Store(join(root, "data", mode));
store.seed();
const selected = plants.filter((p) => !flag("plant") || p.id === flag("plant"));
if (!selected.length) throw new Error("Unknown --plant");
const hours = (key: string, fallback: number) => {
  const v = Number(process.env[key] || fallback);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${key} must be positive`);
  return v;
};
async function runJobs(kind: string, force = false) {
  let errors = 0,
    calls = 0;
  const max = hours("MAX_MODEL_CALLS", 5);
  const tasks: {
    id: string;
    hours: number;
    model: boolean;
    fn: () => Promise<void>;
  }[] = [];
  if (kind === "tick" || kind === "collect")
    for (const s of store.all(
      "SELECT * FROM sources WHERE approved=1 ORDER BY id",
    )) {
      if (
        !selected.some((p) => p.id === s.plant) ||
        (flag("source") && s.id !== flag("source"))
      )
        continue;
      tasks.push({
        id: "collect:" + s.id,
        hours: s.hours,
        model: false,
        fn: () => collect(store, s),
      });
    }
  if (kind === "tick" || kind === "discover")
    for (const p of selected)
      tasks.push({
        id: "discover:" + p.id,
        hours: hours("DISCOVERY_HOURS", 168),
        model: true,
        fn: () => discover(store, p),
      });
  if (kind === "tick" || kind === "synthesize")
    for (const p of selected)
      tasks.push({
        id: "synthesize:" + p.id,
        hours: hours("SYNTHESIS_HOURS", 24),
        model: true,
        fn: () => synthesize(store, p),
      });
  if (flag("source") && !tasks.length)
    throw new Error("Unknown or unapproved --source");
  // Collect first. Model jobs sort by due time to prevent a daily synthesis job starving weekly discovery.
  for (const t of tasks)
    store.run("INSERT OR IGNORE INTO jobs(id) VALUES (?)", t.id);
  tasks.sort(
    (a, b) =>
      Number(a.model) - Number(b.model) ||
      store.get("SELECT next_at FROM jobs WHERE id=?", a.id).next_at -
        store.get("SELECT next_at FROM jobs WHERE id=?", b.id).next_at,
  );
  for (const t of tasks) {
    if (t.model && calls >= max) continue;
    if (t.model && !process.env.ANTHROPIC_API_KEY) {
      console.log(`${t.id}: skipped; ANTHROPIC_API_KEY not configured`);
      continue;
    }
    try {
      const ran = await job(
        store,
        t.id,
        t.hours,
        async () => {
          console.log(`Running ${t.id}`);
          if (t.model) calls++;
          await t.fn();
        },
        force,
      );
      if (ran) console.log(`Completed ${t.id}`);
    } catch (e) {
      console.error(`${t.id}: ${String(e)}`);
      errors++;
    }
  }
  if (errors)
    console.error(`${errors} jobs failed; details and retry times saved.`);
  return errors;
}
async function main() {
  switch (command) {
    case "demo":
      demo(store);
      console.log(
        "Synthetic demonstration saved. Run npm run dashboard. No model or network calls.",
      );
      break;
    case "serve":
      serve(store, mode, Number(process.env.PORT || 4317));
      return;
    case "collect":
    case "discover":
    case "synthesize":
      if (command !== "collect" && !process.env.ANTHROPIC_API_KEY)
        throw new Error("Set ANTHROPIC_API_KEY for live model agents");
      process.exitCode = (await runJobs(command, args.includes("--force")))
        ? 1
        : 0;
      break;
    case "tick":
      process.exitCode = (await runJobs("tick")) ? 1 : 0;
      break;
    case "worker":
      console.log(
        "Worker checks persistent due jobs every 60 seconds. Ctrl+C to stop.",
      );
      while (true) {
        await runJobs("tick");
        await new Promise((r) => setTimeout(r, 60000));
      }
      break;
    case "status":
      console.log(
        JSON.stringify(
          {
            mode,
            plants: store.all("SELECT id FROM plants"),
            jobs: store.all("SELECT * FROM jobs"),
            sources: store.all(
              "SELECT id,plant,approved,last_checked,last_changed,error FROM sources",
            ),
          },
          null,
          2,
        ),
      );
      break;
    case "approve": {
      const id = flag("source");
      const s = store.get("SELECT * FROM sources WHERE id=?", id || "");
      if (!s) throw new Error("Use --source DISC-...");
      safeURL(s.url);
      store.run("UPDATE sources SET approved=1 WHERE id=?", s.id);
      store.event(
        "source_approved",
        s.id,
        "User CLI approval; facility match still requires claim review",
      );
      console.log("Approved " + s.url);
      break;
    }
    case "schedule": {
      const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
      console.log(
        "# Example only; nothing installed. Copy .env.example to .env and set credentials first.",
      );
      console.log(
        `*/15 * * * * cd ${q(root)} && ${q(process.execPath)} --env-file=.env ${q(join(root, "node_modules/tsx/dist/cli.mjs"))} src/cli.ts tick >> ${q(join(root, "data/worker.log"))} 2>&1`,
      );
      if (!existsSync(join(root, ".env")))
        console.log("# .env does not exist yet.");
      break;
    }
    default:
      throw new Error(
        "Commands: demo, serve, collect, discover, synthesize, tick, worker, status, approve, schedule",
      );
  }
  store.close();
}
main().catch((e) => {
  console.error(String(e));
  store.close();
  process.exitCode = 1;
});
