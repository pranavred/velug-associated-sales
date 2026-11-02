# Connect inventory

Supported: CSV/JSON uploads with column mapping, and a generic source-scoped HTTP API for ERP/WMS exports. No native SAP, NetSuite, Dynamics, or other vendor connector is claimed. Run a small adapter in your environment using your inventory system's existing API/export permissions.

## Data shape

Required: `sku`, `name`. Optional: `description`, `applications` (array or `|`-separated), `quantity` (nonnegative number; blank/null means unknown), `unit`, `regions` (two-letter country codes or `*`, array or `|`-separated), `grade`, `specifications`, `sdsUrl`, `tdsUrl` (HTTPS links), `active` (boolean).

See [example CSV](../examples/inventory.csv). Rows are synthetic, not products offered by Velug. Add meaningful application/specification text. Blank availability or region is visibly unconfirmed.

Identity is **company + source + SKU**. Identical SKUs from two source systems remain distinct. Upserts preserve the internal product ID. Refresh stock often enough to meet the configured freshness threshold.

## Token and endpoint

An owner creates a token in Settings for one source, such as `erp`. Store it in your secret manager. Tokens can only import into that company/source; they cannot read inventory, users, or research. Revoke them in Settings.

```http
POST /associated-sales/api/inventory/import
Authorization: Bearer <inventory-token>
Content-Type: application/json
Idempotency-Key: <stable-id-for-this-batch>

{
  "source": "erp",
  "mode": "upsert",
  "asOf": "2026-11-02T12:00:00Z",
  "rows": [
    { "sku": "FILTER-001", "name": "Process-water filter", "quantity": 25,
      "unit": "each", "applications": ["filtration"], "regions": ["US"],
      "specifications": "Verify dimensions, flow, micron rating and materials",
      "active": true }
  ]
}
```

Use your deployment's prefix, or `/api/inventory/import` at root. `asOf` is the inventory timestamp; stale data stays stale when imported again. It cannot be more than five minutes in the future. Without it, the server records import time. A snapshot older than the latest accepted timestamp for the same source is rejected atomically.

- `upsert` adds/updates supplied products. Send `active:false` for retired SKUs.
- `replace` atomically replaces **one complete source**; omitted SKUs are removed. Never split a replacement into multiple requests.
- Empty imports are rejected. Invalid/duplicate rows reject the whole import.
- Same-key/same-payload retries return the original receipt. Changed data with the same key returns `409`.
- Limits: 1,000 rows, 2 MB HTTP body, 1.5 MB normalized payload. Use smaller upsert batches for large catalogs.
- `400`: validation; `401/403`: access/source/role; `409`: key conflict; `413`: too large; `429`: rate limited.

CSV upload supports `mapping`, such as `{ "sku":"ItemCode", "name":"ItemName", "quantity":"Available" }`. The browser provides a mapping UI. The API accepts `csv` text instead of `rows`. An explicit empty mapping value omits that field; an absent mapping key uses the canonical column name.

## Scheduled export

Store `ASSOCIATED_SALES_URL`, `INVENTORY_TOKEN`, and `INVENTORY_SOURCE` in the scheduler's private environment:

```sh
node scripts/sync-inventory.mjs inventory-export.json
```

The file is an array of normalized products. The script sends 500-row upsert batches. Set both `SYNC_ID` and `INVENTORY_AS_OF` to stable values for that export; preserve them on retries and change them for a fresh export. If a later batch fails, completed batches remain imported and can be retried idempotently. The script never deletes missing products. Retire them with `active:false`, or a single complete replacement snapshot.

## Research and qualification

Only active, nonzero-stock, fresh, region-eligible products enter matching. Unknown stock/regions remain visibly unconfirmed. The default shortlist contains 80 eligible products chosen by lexical relevance from up to 10,000 catalog records. Results show examined/eligible/selected counts and warn when truncated; matching is not exhaustive for arbitrarily large catalogs.

Research submissions require `requestKey` or `Idempotency-Key`. Retries return the same job even after completion; intentional reruns use a new key. Active identical inputs coalesce, with every request key retained. Incomplete work is visible and does not automatically repeat uncertain provider calls.

Results retain the original product snapshot and recheck current eligibility when viewed or qualified. Removed, stale, zero-stock, or newly region-excluded products cannot be qualified. Questions and answers stay attached to the company/job/product.

Session-authenticated company API requests also require `X-Associated-Sales-Company: <displayed-company-id>`. The server rejects stale-tab mismatches with 409 before reading or changing company data. This header is not needed for source-scoped integration tokens.
