import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { CloudDatabase } from "./d1-db.js";
import { configuration } from "./config.js";
import { createHandler } from "./http.js";
import { processResearch, recoverInterrupted } from "./jobs.js";
import { dispatchResearch, reconcileQueued } from "./dispatch.js";
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  RESEARCH: Workflow<{ id: string }>;
  PUBLIC_ORIGIN: string;
  BASE_PATH: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  SETUP_TOKEN?: string;
  MAX_MODEL_CALLS_PER_DAY?: string;
  INVENTORY_MAX_AGE_DAYS?: string;
  MAX_CATALOG_CANDIDATES?: string;
}
const configFor = (env: Env) =>
  configuration(env as unknown as Record<string, string | undefined>);
export class ResearchWorkflow extends WorkflowEntrypoint<Env, { id: string }> {
  async run(event: WorkflowEvent<{ id: string }>, step: WorkflowStep) {
    // Persisted phases and a single-owner DB lease guard every external call. Never
    // automatically replay an interrupted chargeable step with an uncertain result.
    await step.do(
      "research-and-match",
      { retries: { limit: 0, delay: "1 second" }, timeout: "8 minutes" },
      async () => {
        await processResearch(
          new CloudDatabase(this.env.DB),
          event.payload.id,
          configFor(this.env),
        );
        return { id: event.payload.id };
      },
    );
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const db = new CloudDatabase(env.DB);
    return createHandler({
      db,
      config: configFor(env),
      asset: async (path) =>
        env.ASSETS.fetch(
          new Request(
            "https://assets.internal" + path.replace(/^\/assets/, ""),
          ),
        ),
      enqueue: (id) => dispatchResearch(db, id, env.RESEARCH),
    })(request, request.headers.get("cf-connecting-ip") || "unknown");
  },
  async scheduled(_event: ScheduledController, env: Env) {
    const db = new CloudDatabase(env.DB);
    await recoverInterrupted(db);
    await reconcileQueued(db, env.RESEARCH);
  },
} satisfies ExportedHandler<Env>;
