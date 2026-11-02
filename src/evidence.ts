import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Store } from "./store.js";
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function evidenceRoute(
  store: Store,
  mode: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
    const hits: any[] = [];
    if (q.length >= 2)
      for (const v of store.all(
        "SELECT v.*,s.title,s.plant FROM versions v JOIN sources s ON s.id=v.source WHERE s.version=v.id",
      )) {
        for (const seg of JSON.parse(v.segments)) {
          const at = seg.text.toLowerCase().indexOf(q.toLowerCase());
          if (at < 0) continue;
          hits.push({
            source_id: v.source,
            plant: v.plant,
            title: v.title,
            locator: seg.locator,
            excerpt: seg.text.slice(Math.max(0, at - 100), at + 300),
            href: `/evidence/${v.id}?locator=${encodeURIComponent(seg.locator)}`,
          });
          if (hits.length >= 30) break;
        }
        if (hits.length >= 30) break;
      }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        query: q,
        hits,
        note: "Searches latest saved source text, not the internet. Maximum 30 passages. A mention is not proof of use.",
      }),
    );
    return true;
  }
  const match = url.pathname.match(/^\/evidence\/([a-f0-9]{64})(\/file)?$/);
  if (!match) return false;
  const v = store.get(
    "SELECT v.*,s.title,s.url,s.plant FROM versions v JOIN sources s ON s.id=v.source WHERE v.id=?",
    match[1],
  );
  if (!v) {
    res.writeHead(404);
    res.end("Evidence version not found");
    return true;
  }
  if (match[2]) {
    try {
      const bytes = readFileSync(v.raw_path);
      const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
      res.setHeader(
        "Content-Type",
        pdf ? "application/pdf" : "application/octet-stream",
      );
      res.setHeader(
        "Content-Disposition",
        `${pdf ? "inline" : "attachment"}; filename="${v.source}-${v.id.slice(0, 12)}.${pdf ? "pdf" : "bin"}"`,
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end("Saved file is unavailable");
    }
    return true;
  }
  const locator = url.searchParams.get("locator");
  const segments = JSON.parse(v.segments);
  const selected = segments.find((s: any) => s.locator === locator);
  const page = locator?.match(/^PDF physical page (\d+)$/)?.[1];
  let external = "";
  try {
    const u = new URL(v.url);
    if (u.protocol === "https:") {
      if (page) u.hash = "page=" + page;
      external = `<a href="${escape(u.href)}" target="_blank" rel="noopener noreferrer">Open original source${page ? " at page " + page : ""}</a>`;
    }
  } catch {}
  const body = segments
    .map(
      (s: any) =>
        `<section${s.locator === locator ? ' id="selected" class="selected"' : ""}><h2>${escape(s.locator)}</h2><p>${escape(s.text)}</p></section>`,
    )
    .join("");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
  );
  res.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evidence · ${escape(v.title)}</title><style>body{font:16px/1.6 system-ui;max-width:950px;margin:40px auto;padding:0 24px;background:#f4f6f0;color:#19342e}section{background:white;padding:20px;margin:18px 0;border:1px solid #ccd7c7;border-radius:12px}section p{white-space:pre-wrap}.selected{border:3px solid #507b37}a{color:#245e47}code{overflow-wrap:anywhere}h2{font-size:18px}</style><a href="/">← Research dashboard</a><h1>${escape(v.title)}</h1><p><strong>${mode === "demo" ? "Synthetic evidence — not a real source extract" : "Public-source evidence · Human review pending"}</strong></p><p>Facility: ${escape(v.plant)} · Source: ${escape(v.source)}<br>Snapshot retrieved: ${escape(v.fetched_at)}<br>Publication date: not independently verified here<br>Version: <code>${escape(v.id)}</code></p><p>${mode === "demo" ? "" : external + " · "}<a href="/evidence/${v.id}/file${page ? "#page=" + page : ""}">Open saved original file</a></p><p>This saved version is the evidence used by the claim. The publisher’s current page may differ. A chemical mention or regulatory limit alone does not establish use or purchases.</p>${selected ? '<p><a href="#selected">Jump to cited passage</a></p>' : ""}${body}</html>`,
  );
  return true;
}
