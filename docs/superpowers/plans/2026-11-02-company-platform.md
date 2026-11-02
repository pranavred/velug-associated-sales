# Company Platform Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task by task, with test-driven-development and a fresh whole-branch review.

**Goal:** Ship a self-hostable, company-isolated inventory and research application at Velug's requested URL.
**Architecture:** Shared TypeScript services and Web Request router backed by a small SQL interface; Node SQLite and Cloudflare D1 adapters. Public research and constrained catalog matching run through a persisted job service and OpenAI Responses.
**Tech Stack:** Node 22, TypeScript, Web Crypto, SQLite/D1, Cloudflare Workflows, plain accessible HTML/CSS/JS, Docker.
**Spec:** `docs/superpowers/specs/2026-11-02-company-platform-design.md`

## Global Constraints

- Preserve the legacy demo and all existing tests.
- No unrelated company branding, secrets, private inventories or publisher photos in GitHub.
- Inventory write tokens are organization/source-scoped; session reads and writes require current membership.
- Root and `/associated-sales` hosting must both work.
- Source citations and model suggestions remain reviewable hypotheses, not validated product compatibility.
- Outreach stays draft-only.

## Review Focus

- An authenticated user guessing another company's IDs must receive no data or write access.
- Imports with duplicate/invalid rows or reused keys must not partially update or erase stock.
- Provider content must never authorize a product or source outside the supplied company catalog/evidence.
- Revoked sessions/tokens, stale catalogs and cancelled/abandoned jobs must stop being actionable.
- Proxy origins, cookie paths and encoded/deep paths must preserve auth and isolation under a prefix.

### Task 1: Database and identity

Files: `app/db.ts`, `app/node-db.ts`, `app/schema.ts`, `app/auth.ts`, `app/config.ts`, `test/platform-auth.test.ts`.
Interfaces: async `Sql.all/get/run/batch`; `Principal {userId,companyId,role,platformAdmin}`; bootstrap, signIn, authenticate, invite/activate, switchCompany, revokeMember; safe path/config helpers.
- [x] Write tests for two organizations, password failure, membership/session revocation, invite reuse, owner/member permissions and transaction rollback; run red.
- [x] Implement schema, SQLite adapter, password/session/invite/token primitives and organization provisioning.
- [x] Run auth tests and existing suite; commit.

### Task 2: Inventory and integration API domain

Files: `app/inventory.ts`, `app/csv.ts`, `test/platform-inventory.test.ts`, `examples/inventory.csv`, `scripts/sync-inventory.mjs`.
Consumes Task 1 SQL/principal; produces parse/import/list/eligible functions with source-scoped atomic receipts.
- [x] Write tests for CSV quoting/BOM, mapping, invalid/duplicate rows, idempotency conflicts, source isolation, replacement, inactive/out-of-stock/stale/region filtering; run red.
- [x] Implement imports, tokens, example fixtures and sync client.
- [x] Run domain suite and commit.

### Task 3: Research, catalog matching and durable jobs

Files: `app/research.ts`, `app/provider.ts`, `app/jobs.ts`, `test/platform-research.test.ts`.
Consumes Task 2 eligible catalog; produces scoped job create/process/cancel/list/get/review and validated provider artifacts.
- [x] Write tests for forged IDs/citations, ambiguous identity, insufficient evidence, failed provider, budget/lease enforcement, cancellation, tenant reads and stale inventory; run red.
- [x] Implement bounded web research, structured matching, job persistence/leases and answer/review records. Mock only external HTTP in deterministic tests.
- [x] Run suite; perform bounded live validation when runtime exists; commit.

### Task 4: HTTP runtime and browser workspace

Files: `app/http.ts`, `app/server.ts`, `app/public/*`, `test/platform-http.test.ts`, `scripts/platform-browser-smoke.mjs`.
Consumes domain functions; produces prefix-safe JSON routes and accessible workspace with auth, imports, research/results, saved answers, team and tokens.
- [x] Write HTTP tests using real temporary DB for unauthorized/cross-origin access, body limits, token restrictions, tenant isolation, prefix cookies/assets and deep links; run red.
- [x] Implement router, Node adapter, bootstrap CLI, background runner and workspace. Reuse Manrope.
- [x] Run full suite, browser smoke and live synthetic-catalog validation; commit.

### Task 5: Portable and Cloudflare deployment

Files: `Dockerfile`, `compose.yaml`, `.dockerignore`, `.env.example`, `app/cloud.ts`, `wrangler.platform.example.jsonc`, `scripts/*`, `docs/self-hosting.md`, `docs/inventory-api.md`, `.github/workflows/verify.yml`.
Consumes shared router/job logic; produces repeatable self-host bootstrap and a fresh Worker/D1/Workflow deployment.
- [ ] Verify runtime parity in local D1 and persistent database reopen; implement Docker and migration/setup/backup instructions.
- [ ] Build/run container or verify it in CI; provision new cloud resources, initialize owner securely and deploy.
- [ ] Add isolated Velug prefix proxy from its deployed baseline; verify preview then production paths/auth and existing website routes.

### Task 6: Review, release and evidence

- [ ] Obtain fresh security/correctness review against this spec and full diff; fix material findings with regression tests.
- [ ] Run final tests, type checks, builds, dependency/secret scans, live validation, and deployed health/flow checks.
- [ ] Update README/roadmap and publish the verified source to the existing GitHub repository; verify CI.
- [ ] Report live URL, local deployment commands, inventory connection options and material limitations. No company outreach is sent.
