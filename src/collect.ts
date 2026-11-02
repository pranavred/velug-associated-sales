import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "cheerio";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { hash, Store, type Segment } from "./store.js";
import { sources } from "./seeds.js";
export const allowedHosts = new Set(
  sources.map((s) => new URL(s.url).hostname),
);
export function safeURL(url: string) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !allowedHosts.has(u.hostname)
  )
    throw new Error("URL must use HTTPS on a configured public publisher host");
  return u;
}
export async function download(
  url: string,
): Promise<{ bytes: Uint8Array; url: string; type: string }> {
  let u = safeURL(url);
  for (let i = 0; i < 5; i++) {
    const r = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
      headers: {
        "User-Agent":
          "PlantResearchDemo/0.1 (public-source research; bounded requests)",
      },
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const location = r.headers.get("location");
      await r.body?.cancel();
      if (!location) throw new Error("Redirect without location");
      u = safeURL(new URL(location, u).href);
      continue;
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw new Error(`HTTP ${r.status}`);
    }
    if (!r.body) throw new Error("Empty body");
    const reader = r.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 20 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Document exceeds 20 MB");
      }
      chunks.push(value);
    }
    return {
      bytes: Buffer.concat(chunks),
      url: u.href,
      type: r.headers.get("content-type") ?? "",
    };
  }
  throw new Error("Too many redirects");
}
export async function parse(
  bytes: Uint8Array,
  type: string,
): Promise<Segment[]> {
  if (Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") {
    const doc = await getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
    try {
      if (doc.numPages > 150) throw new Error("PDF exceeds 150-page limit");
      const out: Segment[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const text = (await page.getTextContent()).items
          .map((v: any) => v.str ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) out.push({ locator: `PDF physical page ${i}`, text });
      }
      if (!out.length)
        throw new Error("PDF has no extractable text; OCR review required");
      return out;
    } finally {
      await doc.destroy();
    }
  }
  if (!/html|text\/plain/.test(type))
    throw new Error(`Unsupported content type: ${type}`);
  const $ = load(Buffer.from(bytes).toString("utf8"));
  $("script,style,nav,footer,header,noscript,svg").remove();
  const root = $("main").first().length ? $("main").first() : $("body");
  const text = root.text().replace(/\s+/g, " ").trim();
  if (text.length < 150) throw new Error("Insufficient readable content");
  if (
    /verify (you are|your age)|access denied|are you (over|21)|date of birth|enable javascript.*cookies/i.test(
      text.slice(0, 6000),
    )
  )
    throw new Error("Access/age gate detected; human review required");
  const segments: Segment[] = [];
  for (let i = 0; i < text.length; i += 6000)
    segments.push({
      locator: `HTML text block ${segments.length + 1}`,
      text: text.slice(i, i + 6000),
    });
  return segments;
}
export function saveVersion(
  store: Store,
  source: any,
  segments: Segment[],
  bytes: Uint8Array,
  finalURL: string,
) {
  const now = new Date().toISOString(),
    id = hash(source.id + JSON.stringify(segments));
  const previous = store.get(
    "SELECT version FROM sources WHERE id=?",
    source.id,
  )?.version;
  const rawDir = join(store.dir, "snapshots");
  mkdirSync(rawDir, { recursive: true });
  const rawPath = join(rawDir, `${id}.bin`);
  if (!store.get("SELECT id FROM versions WHERE id=?", id)) {
    writeFileSync(rawPath, bytes);
    store.run(
      "INSERT INTO versions VALUES (?,?,?,?,?,?)",
      id,
      source.id,
      now,
      finalURL,
      rawPath,
      JSON.stringify(segments),
    );
  }
  store.run(
    "UPDATE sources SET last_checked=?,last_changed=CASE WHEN version IS NULL OR version<>? THEN ? ELSE last_changed END,version=?,error=NULL WHERE id=?",
    now,
    id,
    now,
    id,
    source.id,
  );
  if (previous && previous !== id)
    store.run(
      "INSERT INTO changes(source,before_version,after_version,at) VALUES (?,?,?,?)",
      source.id,
      previous,
      id,
      now,
    );
  store.event(
    previous === id
      ? "unchanged"
      : previous
        ? "source_changed"
        : "source_collected",
    source.id,
    `Version ${id.slice(0, 12)}; ${segments.length} text segments`,
  );
  return previous !== id;
}
export async function collect(store: Store, source: any) {
  try {
    const doc = await download(source.url);
    const segments = await parse(doc.bytes, doc.type);
    saveVersion(store, source, segments, doc.bytes, doc.url);
  } catch (e) {
    store.run(
      "UPDATE sources SET last_checked=?,error=? WHERE id=?",
      new Date().toISOString(),
      String(e),
      source.id,
    );
    throw e;
  }
}
