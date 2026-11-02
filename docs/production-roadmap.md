# Production requirements

These are planned requirements, not implemented features. The current release is a local-evaluation prototype.

## 1. Inventory integration and product eligibility

Start with a read-only CSV/JSON import and a documented HTTP adapter contract. Do not claim SAP, NetSuite, Dynamics, or other ERP integration until a real adapter has been implemented and tested with an authorized system.

Each product record needs a stable seller/SKU key, name, application categories, specifications, units, available quantity, region, pack size, status, source-system identifier, and synchronization timestamp. Chemical records also need relevant grade/specification and SDS/TDS references; a chemical family or CAS identifier alone does not prove interchangeability.

Imports must validate data, report rejected rows, upsert idempotently, track deletions and stale stock, and avoid exposing inventory credentials to the browser or model. Read-only connector credentials should be independently revocable. Stock information must show its last refresh time.

## 2. Research-to-product matching and rep questions

Restrict candidates to the seller's eligible catalog. Apply product/region/status constraints before ranking. Distinguish current evidence from sector assumptions. Return actual SKU IDs, supporting evidence, missing requirements, and reasons for exclusion. Abstain when evidence is insufficient; do not invent a product, availability, technical compatibility, savings, or buying intent.

Questions should resolve decision-relevant gaps: existing treatment/product, unmet problem, specification, incumbent coverage, qualification authority, and timing. Record the rep's answers and use them to revise or reject suggestions. Technical product approval stays with qualified people. Existing curated chemical rules must be extended and evaluated before claiming broad industrial coverage.

## 3. Customer data boundaries

For a public shared service, introduce individual accounts, company membership, roles, and enforced company scoping on every inventory, research, export, review, evidence, and job route. Add adversarial tests for cross-company access and an auditable identity for each write. Alternatively, define and verify a separate single-company deployment model for private pilots.

## 4. Live AI validation and operations

Configure provider secrets securely and validate a bounded real discovery/collection/extraction run. Measure source relevance, incorrect-site attribution, unsupported findings, qualified-product precision, rep usefulness, latency, and actual cost against reviewed examples. A successful API call is not an accuracy result.

Add per-company quotas, monetary budget monitoring, queue limits, cancellation, failure recovery, deletion/retention controls, backups, and a restore test. The current cap counts calls rather than spend. Cloud periodic refresh of existing plants is not implemented.

## 5. Velug route and release

The requested destination is `https://velug.ai/associated-sales`. The current website runs on Vercel/Next.js; this app runs on Cloudflare. Choose and implement a verified integration: a prefix-aware app behind a narrowly scoped reverse proxy, or an app migrated into the website. A redirect to a separate host would not satisfy the requested in-place URL.

Cover prefixed API/evidence/asset links, sign-in and sign-out redirects, a uniquely named cookie scoped to `/associated-sales`, origin checks, and direct/deep-link navigation. Verify that existing Velug routes and cookies still work.

Create the website release from its deployed baseline or an isolated checkout; unrelated in-progress website changes must not be swept into this release. Verify preview behavior, authenticated end-to-end flows, responsive UI, errors, rollback, and production health before announcing general availability.

## Pilot acceptance

Use one authorized seller catalog and a small buyer-account set. Prove a refresh, an invalid/stale product exclusion, evidence-backed account research, a useful rep question, a recorded answer, and the resulting qualified or rejected recommendation. No public launch claim until this complete path works and customer boundaries are verified.
