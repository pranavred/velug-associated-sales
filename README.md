# Associated Sales by Velug

Connect your inventory, research a manufacturer or buyer, and prepare relevant upsell and add-on sales questions. Built by [Velug AI](https://velug.ai), available under the MIT license.

## Company workspace

- **Inventory:** CSV/JSON uploads with column mapping, atomic source snapshots or upserts, stable SKUs, freshness/stock/region checks, and a scoped integration API.
- **Separate company access:** individual accounts, owner/member roles, one-use invitations, immediate revocation, company switching, and isolated inventory/research records.
- **Company research:** standard or deeper web research through OpenAI, cited evidence with dates, catalog-constrained matching, and explicit unknowns.
- **Better sales questions:** product-specific qualification questions, missing requirements, disqualifying conditions, saved answers, and human review decisions.
- **Portable deployment:** Docker Compose or native Node + SQLite; Cloudflare Workers + D1 + Workflows; root or `/associated-sales` hosting.

No public signup is enabled. A company owner grants access. Inventory integration is a generic CSV/JSON/API adapter, not a packaged native connector for a particular ERP. See [inventory integration](docs/inventory-api.md).

## Start inside your company

```sh
cp .env.example .env
# Set the initial company/email/password and your OPENAI_API_KEY privately.
docker compose up -d --build
```

Open `http://127.0.0.1:4319/associated-sales`. Remove the bootstrap password after initialization. Native Node installation, HTTPS/proxy configuration, backups, identity limitations, and Cloudflare deployment are covered in [self-hosting](docs/self-hosting.md).

The source is free. AI/search API calls and hosting may cost money. Each company has a persistent daily model-call cap; it limits attempts, not dollars. Without a provider key, inventory and account management still work.

## What a suggestion means

The flow is **seller inventory → buyer research → eligible catalog shortlist → evidence and unknowns → rep questions → human qualification**.

Only supplied product IDs and cited source IDs can appear in a result. Inactive, zero-stock, stale, or region-excluded products are filtered out, and current availability is checked again before qualification. Unknown stock/regions are explicitly unconfirmed. The default matcher examines up to 10,000 products and sends an 80-product shortlist; coverage and truncation are shown.

AI findings and evidence dates can be wrong. A citation establishes a reference, not independent semantic verification. Historical or undated evidence adds a question confirming whether the process still exists. Suggestions do not establish chemical compatibility, actual usage, demand, purchasing intent, or revenue. Qualified technical staff must review product suitability before quoting or changing a process.

The application sends target-company information and selected product descriptions/specifications to OpenAI with `store:false`. Stock quantities, credentials, and integration tokens are excluded. See the deployment guide for data-handling details and operational limits.

## Verify

```sh
npm ci
npm run verify
npm run build
npm run platform:cloud:check
npm run test:d1
npm run test:worker-provider
npx playwright install chromium
npm run test:browser
npx wrangler deploy --dry-run --config wrangler.platform.example.jsonc
npm audit
```

CI also builds and boots the Docker image and checks persisted account login after restart. A live provider check is opt-in and billable: run `node --env-file=.env --import tsx scripts/live-validation.ts`. It uses a public manufacturer and synthetic products, then writes the report to ignored `data/live-validation.json`. Deterministic tests do not prove general model accuracy. See [verification records](docs/verification/).

## Legacy evidence demonstration

The original local evidence/quote-review demonstration remains under `src/`, with its separate Cloudflare example under `cloud/`. It uses synthetic fixtures and an optional Anthropic adapter; it is not the company workspace runtime.

```sh
npm run prepare-demo
PORT=4317 npm run dashboard
```

Keep that unauthenticated localhost dashboard private. Do not point the new application at its database or deploy its shared-password Worker as the company platform.

## License and included content

[MIT](LICENSE), copyright Pranav Reddy. Repository content includes source, tests, public-source seed URLs, synthetic fixtures, and the licensed Manrope font. It excludes private inventories, downloaded publisher documents, third-party plant photos, credentials, and machine-specific configurations.

Dependencies retain their own licenses: [dependency inventory](docs/dependency-licenses.csv), [third-party notices](THIRD_PARTY_NOTICES.md), and [font license](assets/FONT-LICENSE.txt). Downloaded source material is not covered by this repository's MIT license. No researched company is implied to be a customer or to endorse Velug.
