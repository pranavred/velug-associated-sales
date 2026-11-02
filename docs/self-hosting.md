# Deploy inside your company

The company workspace has the same application logic on Node + SQLite and Cloudflare + D1. No hosted Velug account is required to self-host. The MIT source is free; OpenAI API use and infrastructure have separate costs.

## Docker Compose

```sh
git clone https://github.com/pranavred/velug-associated-sales.git
cd velug-associated-sales
cp .env.example .env
# Edit .env privately. Set BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD (14+ characters),
# BOOTSTRAP_COMPANY, and OPENAI_API_KEY. Never commit this file.
docker compose up -d --build
```

Open `http://127.0.0.1:4319/associated-sales`. The first start creates the owner and instance administrator. Remove `BOOTSTRAP_PASSWORD` from `.env` and recreate the container after setup. Bootstrap never overwrites an initialized instance. Without an AI key, inventory, accounts, and existing results still work.

For LAN or internet access, place an HTTPS reverse proxy in front of port 4319. Set `PUBLIC_ORIGIN=https://sales.your-company.example` to the exact public origin and preserve the request `Origin` header and full path. `BASE_PATH=/associated-sales` serves under that prefix; set `BASE_PATH=` to serve at `/`. Never expose a production login over plain HTTP. The Compose port binds to loopback by default.

The named volume `sales-data` contains SQLite. Run **one app replica** against that volume. This is a single-server deployment, not a multi-region database cluster. The process polls persisted queued jobs. Restarted in-progress jobs fail with an explicit uncertain-billing message after their lease expires; they are not silently replayed.

## Native Node

Requires Node 22.13+ (built-in SQLite) and npm:

```sh
npm ci
cp .env.example .env
# Set the same private variables as above.
npm run build
npm start
```

`npm run dev` runs TypeScript directly. `npm run setup` initializes an owner separately. Persist and restrict permissions on `data/`. Set `HOST=0.0.0.0` only behind the intended network/proxy controls.

## Company access

- Each person has an individual account. Sessions expire after eight hours.
- Owners import inventory, manage tokens, invite/revoke members, and run research.
- Members read their catalog, run research, and save qualification answers.
- Instance administrators create isolated companies in Settings, each with a first-owner invitation.
- Invitations are one-use, expire after 24 hours, and must be shared by the owner. No email is sent automatically.
- Revocation removes membership, company sessions, and outstanding invitations.
- Settings supports password changes; this revokes all account sessions.

There is no public signup, SSO, SCIM, email recovery, or MFA in this release. Review your identity and retention requirements; an SSO-aware gateway can provide an additional access layer. The instance operator controls the database and can access its contents. Isolation is enforced in the application, not end-to-end encryption.

For a forgotten password on Node, a trusted instance operator can load `ADMIN_USER_EMAIL` and `ADMIN_NEW_PASSWORD` from a private environment and run:

```sh
node --env-file=.env dist/app/admin.js reset-password
```

Remove the temporary reset variables afterward. Docker supports the same command with `docker compose exec sales node dist/app/admin.js reset-password` after supplying private variables to that container. Keep passwords out of command arguments and shared shell history.

## Cloudflare deployment

Use fresh resources; the legacy `cloud/` demo has a different schema and authentication model.

```sh
cp wrangler.platform.example.jsonc wrangler.platform.jsonc
npx wrangler d1 create associated-sales-platform
# Put the returned database ID in private wrangler.platform.jsonc.
# Set PUBLIC_ORIGIN to your public HTTPS origin and BASE_PATH as required.
npx wrangler d1 migrations apply associated-sales-platform --remote --config wrangler.platform.jsonc
npx wrangler secret put OPENAI_API_KEY --config wrangler.platform.jsonc
npx wrangler secret put SETUP_TOKEN --config wrangler.platform.jsonc
npx wrangler deploy --config wrangler.platform.jsonc
```

Generate a long random `SETUP_TOKEN`. Initialize by POSTing JSON with `token`, `email`, `password`, and `company` to `<origin><prefix>/api/setup`, including `Origin: <PUBLIC_ORIGIN>`. Use a protected request file or program, not secrets in command arguments. Delete the setup secret immediately afterward:

```sh
npx wrangler secret delete SETUP_TOKEN --config wrangler.platform.jsonc
```

The Worker includes static assets, D1, and a Workflow with automatic chargeable-step retries disabled. A ten-minute schedule marks interrupted runs failed and reconciles queued delivery gaps. Terminal Workflows are not automatically replayed. Public Worker URLs still require login and tenant checks. To proxy through another website, rewrite only `<prefix>/:path*` to the Worker with the same prefix, and set `PUBLIC_ORIGIN` to the user-facing site.

## Backups, upgrades, and recovery

Back up the entire SQLite volume while the service is stopped, or use SQLite's online backup API. Copying only the database file during WAL writes can lose committed data. Encrypt backups and test restores in isolation. For D1, use Cloudflare export/Time Travel. Exports contain company data and password hashes; treat them as sensitive.

Before upgrading, back up, read migrations, and test in an isolated instance. `migrations/0001_platform.sql` is the initial D1 schema; Node initializes the equivalent schema. Future schema changes require explicit migrations. Restore matching code and data together on rollback.

Rate limits, daily per-company model-call caps, three active jobs per company, 1,000-row/2 MB imports, and bounded catalog matching limit use. These are **not dollar caps**. Configure provider-side spend limits. Records and audit events persist until the operator removes them; there is no automatic retention purge or end-user data export/delete workflow yet.

## Data sent to AI

OpenAI receives target company details, public research, and shortlisted product identifiers/descriptions/applications/specifications. Stock quantities, credentials, and integration tokens are excluded. Requests set `store:false`; provider processing and retention terms still apply. Product descriptions can contain proprietary information, so configure your provider according to company policy. Research URLs are not fetched directly from the self-hosted server.

Results cite sources and label evidence dates. Historical/undated evidence adds a current-process confirmation question. Dates and claims are model-extracted, not independently certified. Review is required before using a suggestion as a quote, compatibility decision, or purchasing signal.
