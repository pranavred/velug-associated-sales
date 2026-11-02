import { plantMedia, photoFiles } from "./plant-media.js";
import { plantOverviews } from "./plant-overview.js";
import { chemicalLeads, confidenceModel } from "./chemical-leads.js";
import { readFileSync } from "node:fs";
import { opportunityState } from "./opportunities.js";
import { randomUUID } from "node:crypto";
import { recentChanges, reviewRequest } from "./review-api.js";
import { createServer } from "node:http";
import { evidenceRoute } from "./evidence.js";
import { Store } from "./store.js";
export function serve(store: Store, mode: string, port: number) {
  const token = randomUUID();
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/review") {
      await reviewRequest(store, token, req, res);
      return;
    }
    if (req.method === "GET" && req.url === "/api/export") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="plant-research-export.json"',
      );
      res.end(
        JSON.stringify(
          {
            mode,
            potential_opportunities: opportunityState(store),
            ...chemicalState(store),
            exported_at: new Date().toISOString(),
            plants: store
              .all("SELECT * FROM plants")
              .map((r) => JSON.parse(r.json)),
            profiles: store
              .all("SELECT * FROM profiles")
              .map((r) => ({ ...r, json: JSON.parse(r.json) })),
            sources: store.all("SELECT * FROM sources"),
            versions: store.all(
              "SELECT id,source,fetched_at,final_url FROM versions",
            ),
            changes: recentChanges(store),
            reviews: store.all("SELECT * FROM reviews"),
            note: "Research export; reviews are local user assertions, not independent certification. Full snapshots remain on the local evidence server.",
          },
          null,
          2,
        ),
      );
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (req.url?.startsWith("/assets/plants/")) {
      const file = req.url.slice("/assets/plants/".length);
      if (!photoFiles.has(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader("Content-Type", "image/jpeg");
      res.end(
        readFileSync(new URL("../assets/plants/" + file, import.meta.url)),
      );
      return;
    }
    if (req.url === "/assets/manrope.woff2") {
      res.setHeader("Content-Type", "font/woff2");
      res.end(
        readFileSync(new URL("../assets/manrope.woff2", import.meta.url)),
      );
      return;
    }
    if (evidenceRoute(store, mode, req, res)) return;
    if (req.url === "/api/state") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          mode,
          potential_opportunities: opportunityState(store),
          ...chemicalState(store),
          review_token: token,
          changes: recentChanges(store),
          reviews: store.all("SELECT * FROM reviews ORDER BY id DESC"),
          budgets: store.all(
            "SELECT * FROM api_budget ORDER BY day DESC LIMIT 7",
          ),
          plants: store
            .all("SELECT * FROM plants")
            .map((r) => JSON.parse(r.json)),
          sources: store.all("SELECT * FROM sources"),
          jobs: store.all("SELECT * FROM jobs"),
          events: store.all("SELECT * FROM events ORDER BY id DESC LIMIT 60"),
          profiles: store
            .all(
              "SELECT * FROM profiles WHERE id IN (SELECT MAX(id) FROM profiles GROUP BY plant)",
            )
            .map((r) => ({
              ...r,
              profile: JSON.parse(r.json),
              json: undefined,
            })),
        }),
      );
      return;
    }
    if (req.url !== "/") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Dashboard: http://127.0.0.1:${port} (${mode})`),
  );
  return server;
}
const html = readFileSync(new URL("./dashboard.html", import.meta.url), "utf8");

function chemicalState(store: Store) {
  const profiles = store
    .all(
      "SELECT * FROM profiles WHERE id IN (SELECT MAX(id) FROM profiles GROUP BY plant)",
    )
    .map((r) => ({ ...r, profile: JSON.parse(r.json) }));
  return {
    chemical_leads: chemicalLeads(
      opportunityState(store),
      profiles,
      store.all("SELECT * FROM sources"),
    ),
    confidence_model: confidenceModel,
    plant_media: plantMedia,
    plant_overviews: plantOverviews(
      profiles,
      store.all("SELECT * FROM sources"),
    ),
  };
}
