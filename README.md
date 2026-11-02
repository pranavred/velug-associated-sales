# Associated Sales by Velug

An open-source prototype for researching industrial facilities, retaining source evidence, and helping sales representatives ask better qualification questions.

Built by [Velug AI](https://velug.ai). **Prototype status: suitable for local evaluation; not a production service for customer inventories.**

## What works today

- Collect approved public HTML/PDF sources and preserve document versions.
- Discover sources and propose cited plant profiles through an optional Anthropic integration.
- Review exact quotes, source locations, changes, and missing evidence.
- Suggest chemical application hypotheses and follow-up questions using a small, curated rule library.
- Suppress opportunities for closure-held facilities and exclude rejected claims.
- Run a deterministic synthetic demonstration without an API key or model calls.

An example question is: “Does the current cleaning program already include the function this proposed add-on provides?” Suggestions are hypotheses for a representative to qualify. They do not establish chemical compatibility, actual usage, demand, purchasing intent, or revenue.

## What is not implemented

Inventory/ERP connectors, catalog ingestion, SKU matching, stock availability, per-company data isolation, individual user accounts, and a production-ready hosted signup flow are not implemented. The cloud research adapter has not been validated with a real model run. The current opportunity rules focus on chemical applications; general industrial-product recommendations require additional rules and evaluation.

The intended workflow is **seller inventory → buyer research → eligible products → evidence and missing information → rep questions → human-qualified opportunity**. Only the research, evidence, and initial question-generation portions exist today. See [the implementation requirements](docs/production-roadmap.md).

## Run locally

Requires Node.js 22.13+ and npm.

```sh
npm ci
npm run prepare-demo
npm run dashboard
```

Open http://127.0.0.1:4317. Demo records are explicitly synthetic, even where facility names refer to real places. No customer relationships or endorsements are implied. The local dashboard has no authentication and binds to localhost; keep it local.

For public-source collection:

```sh
npm run collect -- --source SRC-001
PORT=4318 npm run dashboard -- --mode live
```

For optional model calls, copy `.env.example` to `.env`, supply your own `ANTHROPIC_API_KEY`, and select a model available to your account:

```sh
npm run discover -- --plant PLANT-001
npm run synthesize -- --plant PLANT-001
```

These commands use paid external APIs. Discovered local sources require approval; new publisher hosts require explicit allowlisting in `src/collect.ts`. Exact quote validation establishes traceability, not semantic correctness. Review every finding before using it in a sales conversation.

## Verify

```sh
npm run verify
npm run cloud:check
npx wrangler deploy --dry-run --config wrangler.example.jsonc
npm audit
```

The initial release passed 34 tests, both TypeScript checks, synthetic demo generation, and Worker bundling. The tests use fixtures and a mocked model adapter; they are not evidence of live AI accuracy. Verification records are in `docs/verification/`.

## Hosting and cost

The source code is free under MIT. The synthetic local demo makes no paid service calls. Model/search usage and hosted infrastructure can cost money; hosting free tiers have limits. The daily model-call cap limits attempts, not dollars.

The `cloud/` implementation targets Cloudflare Workers, Workflows, D1, and R2. `wrangler.example.jsonc` contains placeholder resources, disables public Worker URLs, and has no scheduled trigger. It is an example, not a ready production configuration. It uses a shared private-demo password, not separate customer accounts.

Before any deployment, provision separate resources, initialize the database schemas and data, set secrets securely, and complete [the production roadmap](docs/production-roadmap.md). The app currently assumes domain-root paths. Hosting at `/associated-sales` requires routing, assets, redirects, cookies, and API URLs to support that prefix.

## Included and excluded content

This repository contains source code, tests, public-source seed URLs, synthetic fixture generation, and the licensed Manrope font. It excludes original research databases, downloaded publisher documents, third-party plant photos, secrets, and machine-specific QA scripts. The evaluation reference checklist is specific to the original five-facility demonstration and is not a general model benchmark.

Third-party dependencies retain their own licenses; see [dependency licenses](docs/dependency-licenses.csv), [third-party notices](THIRD_PARTY_NOTICES.md), and [the font license](assets/FONT-LICENSE.txt). Downloaded material is not covered by this repository's MIT license.

## Contributing

Open an issue with a reproducible example or propose an adapter against the documented inventory requirements. Use synthetic data in issues and tests. Do not upload customer inventories, credentials, proprietary pricing, or downloaded source archives.

## License

[MIT](LICENSE), copyright 2026 Pranav Reddy. This is a Velug project; it is not affiliated with or endorsed by the companies named in sample data.
