import { Parser } from "htmlparser2";
export const sha = async (value: string | Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : (value as Uint8Array<ArrayBuffer>),
      ),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export function plantInput(value: any) {
  if (
    !value ||
    typeof value.name !== "string" ||
    typeof value.location !== "string"
  )
    throw Error("Enter plant name and location");
  const name = value.name.trim().replace(/\s+/g, " "),
    location = value.location.trim().replace(/\s+/g, " ");
  if (
    name.length < 3 ||
    name.length > 160 ||
    location.length < 3 ||
    location.length > 240
  )
    throw Error("Use a plant name and a city/state or street address");
  return { name, location };
}
export function publicURL(value: string) {
  const u = new URL(value);
  const host = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !host.includes(".") ||
    !/[a-z]$/.test(host) ||
    /[\[\]:]/.test(host) ||
    /^(?:\d+\.)+\d+$/.test(host) ||
    /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host) ||
    host.endsWith(".arpa")
  )
    throw Error("Source must be a public HTTPS website");
  u.hash = "";
  return u;
}
export function searchSources(response: any) {
  if (response.stop_reason !== "end_turn")
    throw Error("Discovery did not finish");
  let searched = false;
  const sources = new Map<string, { url: string; title: string }>();
  for (const block of response.content) {
    if (block.type === "web_search_tool_result") {
      searched = true;
      if (!Array.isArray(block.content)) throw Error("Web search failed");
    }
    if (block.type === "text")
      for (const c of block.citations || []) {
        if (c.type !== "web_search_result_location") continue;
        try {
          const url = publicURL(c.url).href;
          sources.set(url, {
            url,
            title: String(c.title || url).slice(0, 300),
          });
        } catch {}
      }
  }
  if (!searched) throw Error("Discovery returned without web search");
  return [...sources.values()].slice(0, 5);
}
export function htmlText(text: string) {
  let skip = 0;
  const parts: string[] = [];
  const hidden = new Set(["script", "style", "noscript", "svg", "head"]);
  const parser = new Parser({
    onopentag(name) {
      if (hidden.has(name)) skip++;
      else if (!skip) parts.push(" ");
    },
    onclosetag(name) {
      if (hidden.has(name)) skip = Math.max(0, skip - 1);
      else if (!skip) parts.push(" ");
    },
    ontext(value) {
      if (!skip) parts.push(value);
    },
  });
  parser.write(text);
  parser.end();
  return parts.join("").replace(/\s+/g, " ").trim();
}
