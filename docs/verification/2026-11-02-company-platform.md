# Company platform verification — 2026-11-02

Scope: new `app/` runtime, preserving the legacy `src/` demonstration.

## Deterministic checks

- 61 unit/domain/HTTP tests passed, including the 34 legacy tests.
- Three Chromium browser flows passed: root hosting, `/associated-sales`, and shared-tab company switching. They cover login, CSV mapping/import, rendered research, answer persistence, invitations/member permissions, mobile overflow, and stale-form rejection.
- Node build and both legacy/platform Cloudflare TypeScript checks pass.
- D1 emulator parity covers password/account flows, tenant isolation, atomic rollback, concurrent idempotent imports, and invitation single-use.
- New Worker bundle dry-run passes. Compatibility date is pinned to the installed runtime.
- Dependency audit reported zero vulnerabilities. Dependency licenses refreshed.
- Independent reviews found and drove fixes for expired leases, configurable stock age, durable request idempotency, revoked invitations, stale-tab company targeting, explicit column omissions, and queued Workflow reconciliation. No unresolved findings remained in the final rereview.

Local Docker daemon was unavailable; the release workflow builds, boots, and restarts the container and checks login persistence. Consult the exact commit's CI result for that evidence.

## Live AI validation

Two bounded local runs used the real OpenAI Responses API (`gpt-4.1-2025-04-14`, hosted web search and structured matching), a public manufacturer, and six **synthetic** inventory records. Each run used two model calls. Four products were eligible; the out-of-stock and inactive products were excluded. The second run returned four reviewable hypotheses and dated findings; every suggestion carried a historical/undated-evidence confirmation question.

The first run surfaced an important limitation: older process documentation was summarized as current. The implementation now requires model-extracted evidence dates, displays them, adds an explicit current-process question for historical/undated evidence, and warns about human verification. This is not independent fact verification or a general accuracy benchmark.

Manual source checks confirmed that the [EPA inspection report](https://19january2017snapshot.epa.gov/www3/region9/water/pretreatment/files/sierra_nevada_brewery_2004-10-08_inspection.pdf) is from 2004 and the [California water-supply project record](https://ceqanet.lci.ca.gov/2017072035) is from 2017. The [company sustainability page](https://sierranevada.com/sustainability) provides current context. These sources do not establish current demand, buying intent, or product compatibility. No company was contacted or represented as a customer.

A 10-micron cartridge hypothesis against historical 5-micron documentation illustrates why technical qualification remains necessary: the UI must not be treated as authorization to substitute specifications. Saved answers and review notes support that human decision; they do not prove it is correct.

Raw live outputs and provider credentials are excluded from the repository. The opt-in validation script is included for reproducibility; fresh results can vary and incur API costs.

## Deployment evidence

Deployment uses fresh Cloudflare Worker/D1/Workflow resources, and a narrow website rewrite from the website's exact previously deployed commit. Existing legacy resources and unrelated local website changes are preserved. Final production URL and CI verification are recorded in the release result.
