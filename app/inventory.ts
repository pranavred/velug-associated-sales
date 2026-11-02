import { fail, text, type Sql } from "./db.js";
import {
  requireOwner,
  randomToken,
  digest,
  audit,
  type Principal,
} from "./auth.js";
export type Product = {
  id: string;
  source: string;
  sku: string;
  name: string;
  description: string;
  applications: string[];
  quantity: number | null;
  unit: string;
  regions: string[];
  grade: string;
  specifications: string;
  sdsUrl: string;
  tdsUrl: string;
  active: boolean;
  updatedAt: number;
};
export type ImportInput = {
  source: string;
  key: string;
  mode: "replace" | "upsert";
  rows: unknown[];
  mapping?: Record<string, string>;
  asOf?: string;
};
export const sourceName = (value: unknown) => {
  const source = text(value, "inventory source", 60);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(source))
    fail(400, "Invalid inventory source");
  return source;
};
function publicLink(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return "";
  const raw = text(value, name, 1000);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(400, `Invalid ${name}: use an HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password)
    fail(400, `Invalid ${name}: use a public HTTPS URL`);
  return url.href;
}
function normalize(value: unknown, mapping: Record<string, string>) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "Each inventory row must be an object");
  const row = value as Record<string, unknown>,
    get = (key: string) =>
      Object.hasOwn(mapping, key)
        ? mapping[key]
          ? row[mapping[key]]
          : undefined
        : row[key];
  const optional = (key: string, max: number) =>
    get(key) == null || get(key) === "" ? "" : text(get(key), key, max, 0);
  const list = (key: string) => {
    const value = get(key);
    if (value == null || value === "") return [];
    const values = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[|;]/)
        : fail(400, `Invalid ${key}`);
    if (values.length > 30) fail(400, `Too many ${key}`);
    return [...new Set(values.map((v) => text(v, key, 100)).filter(Boolean))];
  };
  const rawQuantity = get("quantity");
  const quantity =
    rawQuantity === null || rawQuantity === undefined || rawQuantity === ""
      ? null
      : typeof rawQuantity === "number" || typeof rawQuantity === "string"
        ? Number(rawQuantity)
        : NaN;
  if (
    quantity !== null &&
    (!Number.isFinite(quantity) || quantity < 0 || quantity > 1e12)
  )
    fail(400, "Invalid quantity");
  const rawActive = get("active");
  let active = true;
  if (rawActive !== undefined && rawActive !== null && rawActive !== "") {
    if ([false, 0, "false", "0", "inactive"].includes(rawActive as any))
      active = false;
    else if (![true, 1, "true", "1", "active"].includes(rawActive as any))
      fail(400, "Invalid active status");
  }
  const regions = list("regions").map((s) => s.toUpperCase());
  if (regions.some((r) => !/^([A-Z]{2}|\*)$/.test(r)))
    fail(400, "Regions must use two-letter country codes or *");
  return {
    sku: text(get("sku"), "SKU", 120),
    name: text(get("name"), "product name", 240),
    description: optional("description", 2000),
    applications: list("applications"),
    quantity,
    unit: optional("unit", 60),
    regions,
    grade: optional("grade", 200),
    specifications: optional("specifications", 2000),
    sdsUrl: publicLink(get("sdsUrl"), "SDS URL"),
    tdsUrl: publicLink(get("tdsUrl"), "TDS URL"),
    active,
  };
}
export async function importInventory(
  db: Sql,
  p: Principal,
  input: ImportInput,
) {
  if (p.role !== "owner" && p.role !== "integration")
    fail(403, "Company owner access required for inventory imports");
  const source = sourceName(input.source),
    key = text(input.key, "idempotency key", 120);
  if (p.role === "integration" && source !== p.source)
    fail(403, "Token is restricted to its inventory source");
  if (!["replace", "upsert"].includes(input.mode))
    fail(400, "Choose replace or upsert");
  if (!Array.isArray(input.rows) || !input.rows.length)
    fail(400, "Empty inventory imports are not allowed");
  if (input.rows.length > 1000)
    fail(
      413,
      "Import at most 1,000 products per request; use upsert batches for larger catalogs",
    );
  const mapping = input.mapping || {};
  if (
    typeof mapping !== "object" ||
    Array.isArray(mapping) ||
    Object.values(mapping).some((x) => typeof x !== "string")
  )
    fail(400, "Invalid column mapping");
  const products = input.rows.map((row) => normalize(row, mapping));
  if (new Set(products.map((p) => p.sku)).size !== products.length)
    fail(400, "Duplicate SKU within the import source");
  const now = Date.now(),
    asOf = input.asOf ? Date.parse(input.asOf) : now;
  if (!Number.isFinite(asOf) || asOf > now + 300000 || asOf < 0)
    fail(400, "Invalid inventory asOf timestamp");
  const fingerprint = await digest(
    JSON.stringify({
      source,
      mode: input.mode,
      products,
      asOf: input.asOf || null,
    }),
  );
  const previous = await db.get(
    "SELECT * FROM imports WHERE company_id=? AND source=? AND request_key=?",
    p.companyId,
    source,
    key,
  );
  if (previous) {
    if (previous.digest !== fingerprint)
      fail(409, "Idempotency key already used with different inventory");
    return JSON.parse(previous.receipt);
  }
  const id = crypto.randomUUID(),
    receipt = {
      id,
      source,
      mode: input.mode,
      imported: products.length,
      syncedAt: now,
      asOf,
    };
  const payload = JSON.stringify(
    products.map((record) => ({
      id: crypto.randomUUID(),
      sku: record.sku,
      record: JSON.stringify(record),
    })),
  );
  if (new TextEncoder().encode(payload).length > 1500000)
    fail(413, "Inventory payload is too large; use smaller upsert batches");
  const statements = [
    {
      sql: "INSERT INTO inventory_sources VALUES (?,?,?) ON CONFLICT(company_id,source) DO UPDATE SET as_of=CASE WHEN excluded.as_of>=inventory_sources.as_of THEN excluded.as_of ELSE -1 END",
      args: [p.companyId, source, asOf],
    },
    {
      sql: "INSERT INTO imports VALUES (?,?,?,?,?,?,?)",
      args: [
        id,
        p.companyId,
        source,
        key,
        fingerprint,
        JSON.stringify(receipt),
        now,
      ],
    },
    {
      sql: `INSERT INTO inventory(id,company_id,source,sku,record,updated_at)
      SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.sku'),json_extract(value,'$.record'),? FROM json_each(?) WHERE 1
      ON CONFLICT(company_id,source,sku) DO UPDATE SET record=excluded.record,updated_at=excluded.updated_at`,
      args: [p.companyId, source, asOf, payload],
    },
  ];
  if (input.mode === "replace")
    statements.push({
      sql: `DELETE FROM inventory WHERE company_id=? AND source=? AND sku NOT IN (SELECT json_extract(value,'$.sku') FROM json_each(?))`,
      args: [p.companyId, source, payload],
    });
  statements.push({
    sql: "INSERT INTO audit_events VALUES (?,?,?,?,?,?)",
    args: [
      crypto.randomUUID(),
      p.companyId,
      p.userId,
      "inventory.imported",
      JSON.stringify(receipt),
      now,
    ],
  });
  try {
    await db.batch(statements);
  } catch (e) {
    const concurrent = await db.get(
      "SELECT * FROM imports WHERE company_id=? AND source=? AND request_key=?",
      p.companyId,
      source,
      key,
    );
    if (concurrent) {
      if (concurrent.digest !== fingerprint)
        fail(409, "Idempotency key already used with different inventory");
      return JSON.parse(concurrent.receipt);
    }
    const latest = await db.get(
      "SELECT as_of FROM inventory_sources WHERE company_id=? AND source=?",
      p.companyId,
      source,
    );
    if (latest && latest.as_of > asOf)
      fail(
        409,
        "This inventory snapshot is older than the latest import for this source",
      );
    throw e;
  }
  return receipt;
}
export async function listInventory(
  db: Sql,
  p: Principal,
  limit = 1000,
  offset = 0,
): Promise<Product[]> {
  const rows = await db.all(
    "SELECT * FROM inventory WHERE company_id=? ORDER BY source,sku LIMIT ? OFFSET ?",
    p.companyId,
    Math.min(Math.max(limit, 1), 10000),
    Math.max(offset, 0),
  );
  return rows.map((row) => ({
    ...JSON.parse(row.record),
    id: row.id,
    source: row.source,
    updatedAt: row.updated_at,
  }));
}
export async function getProduct(
  db: Sql,
  companyId: string,
  id: string,
): Promise<Product | null> {
  const row = await db.get(
    "SELECT * FROM inventory WHERE company_id=? AND id=?",
    companyId,
    id,
  );
  return row
    ? {
        ...JSON.parse(row.record),
        id: row.id,
        source: row.source,
        updatedAt: row.updated_at,
      }
    : null;
}
export function eligibility(
  product: Product,
  options: { region: string; maxAgeDays: number; now?: number },
) {
  const reasons: string[] = [];
  if (!product.active) reasons.push("Inactive");
  if (product.quantity === 0) reasons.push("Out of stock");
  if (
    product.updatedAt <
    (options.now ?? Date.now()) - options.maxAgeDays * 86400000
  )
    reasons.push("Inventory is stale");
  if (
    options.region &&
    product.regions.length &&
    !product.regions.includes("*") &&
    !product.regions.includes(options.region.toUpperCase())
  )
    reasons.push("Outside selling region");
  return {
    eligible: reasons.length === 0,
    reasons,
    availability: product.quantity === null ? "unknown" : "reported",
    regionVerified: Boolean(options.region && product.regions.length),
  };
}
export async function createInventoryToken(
  db: Sql,
  p: Principal,
  source: string,
  label: string,
) {
  requireOwner(p);
  source = sourceName(source);
  label = text(label, "token label", 100);
  const id = crypto.randomUUID(),
    token = "as_inv_" + randomToken();
  await db.run(
    "INSERT INTO integration_tokens VALUES (?,?,?,?,?,?,NULL)",
    id,
    p.companyId,
    source,
    label,
    await digest(token),
    Date.now(),
  );
  await audit(db, p, "integration.created", { id, source });
  return { id, token, source };
}
export async function inventoryPrincipal(
  db: Sql,
  token: string,
): Promise<Principal | null> {
  if (!/^as_inv_[a-f0-9]{64}$/.test(token)) return null;
  const row = await db.get(
    "SELECT t.*,c.name FROM integration_tokens t JOIN companies c ON c.id=t.company_id WHERE hash=? AND revoked_at IS NULL",
    await digest(token),
  );
  return row
    ? {
        userId: row.id,
        email: "",
        companyId: row.company_id,
        companyName: row.name,
        role: "integration",
        platformAdmin: false,
        source: row.source,
      }
    : null;
}
export async function revokeInventoryToken(db: Sql, p: Principal, id: string) {
  requireOwner(p);
  if (
    !(await db.run(
      "UPDATE integration_tokens SET revoked_at=? WHERE company_id=? AND id=? AND revoked_at IS NULL",
      Date.now(),
      p.companyId,
      id,
    ))
  )
    fail(404, "Integration token not found");
  await audit(db, p, "integration.revoked", { id });
}
