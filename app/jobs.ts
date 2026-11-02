import { fail, text, type Sql } from "./db.js";
import { digest, audit, type Principal } from "./auth.js";
import {
  eligibility,
  listInventory,
  getProduct,
  type Product,
} from "./inventory.js";
import {
  researchInput,
  validateMatches,
  evidenceCaution,
  OpenAIProvider,
  type Provider,
  type ResearchArtifact,
  type Usage,
} from "./provider.js";
import type { Config } from "./config.js";
export async function createResearch(
  db: Sql,
  p: Principal,
  raw: unknown,
  config: Config,
) {
  if (p.role === "integration")
    fail(403, "Inventory integrations cannot run research");
  if (!config.apiKey) fail(503, "Research provider is not configured");
  const input = researchInput(raw),
    fingerprint = await digest(JSON.stringify(input)),
    now = Date.now();
  const requestKey = (raw as any)?.requestKey
    ? text((raw as any).requestKey, "request key", 120)
    : crypto.randomUUID();
  const prior = async () => {
    const row = await db.get(
      "SELECT j.id,j.status,r.fingerprint FROM research_requests r JOIN research_jobs j ON j.id=r.job_id WHERE r.company_id=? AND r.request_key=?",
      p.companyId,
      requestKey,
    );
    if (row && row.fingerprint !== fingerprint)
      fail(409, "Request key already used with different research");
    return row ? { id: row.id, status: row.status } : null;
  };
  const remember = async (job: { id: string; status: string }) => {
    await db.run(
      "INSERT INTO research_requests VALUES (?,?,?,?) ON CONFLICT(company_id,request_key) DO NOTHING",
      p.companyId,
      requestKey,
      job.id,
      fingerprint,
    );
    return (await prior())!;
  };
  const previous = await prior();
  if (previous) return previous;
  const active = () =>
    db.get(
      "SELECT id,status FROM research_jobs WHERE company_id=? AND fingerprint=? AND status IN ('queued','running')",
      p.companyId,
      fingerprint,
    );
  const existing = await active();
  if (existing) return remember(existing as { id: string; status: string });
  const id = crypto.randomUUID();
  try {
    await db.batch([
      {
        sql: "INSERT INTO research_jobs(id,company_id,user_id,input,fingerprint,status,created_at,updated_at) SELECT ?,?,?,?,?,'queued',?,? WHERE (SELECT count(*) FROM research_jobs WHERE company_id=? AND status IN ('queued','running'))<3",
        args: [
          id,
          p.companyId,
          p.userId,
          JSON.stringify(input),
          fingerprint,
          now,
          now,
          p.companyId,
        ],
      },
      {
        sql: "INSERT INTO research_requests SELECT ?,?,id,? FROM research_jobs WHERE id=?",
        args: [p.companyId, requestKey, fingerprint, id],
      },
    ]);
  } catch (e) {
    const retried = await prior();
    if (retried) return retried;
    const duplicate = await active();
    if (duplicate) return remember(duplicate as { id: string; status: string });
    throw e;
  }
  if (!(await db.get("SELECT id FROM research_jobs WHERE id=?", id)))
    fail(429, "This company already has three active research jobs");
  await audit(db, p, "research.queued", { id, name: input.name });
  return { id, status: "queued" };
}
async function usageEvent(
  db: Sql,
  companyId: string,
  jobId: string,
  phase: string,
  usage: Usage,
) {
  await db.run(
    "INSERT INTO usage_events VALUES (?,?,?,?,?,?,?,?,?,?)",
    crypto.randomUUID(),
    companyId,
    jobId,
    phase,
    usage.model,
    usage.responseId,
    usage.inputTokens,
    usage.outputTokens,
    usage.searchCalls,
    Date.now(),
  );
}
async function reserve(db: Sql, companyId: string, max: number) {
  const result = await db.get(
    "INSERT INTO budgets VALUES (?,?,1) ON CONFLICT(company_id,day) DO UPDATE SET calls=calls+1 WHERE calls<? RETURNING calls",
    companyId,
    new Date().toISOString().slice(0, 10),
    max,
  );
  if (!result)
    fail(429, "Daily model-call limit reached; retry after UTC midnight");
}
export async function recoverInterrupted(db: Sql) {
  await db.run(
    "UPDATE research_jobs SET status='failed',error='Research was interrupted. A provider call may have completed; its billing outcome is uncertain. Start a new run explicitly.',updated_at=? WHERE status='running' AND lease_until<?",
    Date.now(),
    Date.now(),
  );
}
export async function processResearch(
  db: Sql,
  id: string,
  config: Config,
  provider: Provider = new OpenAIProvider(config),
) {
  const lease = crypto.randomUUID(),
    now = Date.now();
  const job = await db.get(
    "UPDATE research_jobs SET status='running',lease=?,lease_until=?,updated_at=? WHERE id=? AND status='queued' RETURNING *",
    lease,
    now + 10 * 60000,
    now,
    id,
  );
  if (!job) return;
  const live = async () =>
    Boolean(
      await db.get(
        "SELECT id FROM research_jobs WHERE id=? AND lease=? AND status='running' AND lease_until>?",
        id,
        lease,
        Date.now(),
      ),
    );
  const phase = async (value: string) =>
    Boolean(
      await db.run(
        "UPDATE research_jobs SET phase=?,updated_at=? WHERE id=? AND lease=? AND status='running' AND lease_until>?",
        value,
        Date.now(),
        id,
        lease,
        Date.now(),
      ),
    );
  try {
    const input = researchInput(JSON.parse(job.input));
    if (!(await live())) return;
    await reserve(db, job.company_id, config.dailyCalls);
    if (!(await phase("research_call"))) return;
    const research = await provider.research(input);
    await usageEvent(db, job.company_id, id, "research", research.usage);
    if (!(await live())) return;
    await db.run(
      "UPDATE research_jobs SET research=?,phase='research_saved',updated_at=? WHERE id=? AND lease=? AND status='running'",
      JSON.stringify(research),
      Date.now(),
      id,
      lease,
    );
    const actor: Principal = {
      userId: job.user_id,
      email: "",
      companyId: job.company_id,
      companyName: "",
      role: "member",
      platformAdmin: false,
    };
    const all = await listInventory(db, actor, 10000),
      total = (await db.get(
        "SELECT count(*) AS n FROM inventory WHERE company_id=?",
        job.company_id,
      ))!.n;
    const eligible = all.filter(
      (p) =>
        eligibility(p, { region: input.region, maxAgeDays: config.staleDays })
          .eligible,
    );
    const words = new Set(
      (research.narrative + " " + input.objective)
        .toLowerCase()
        .match(/[a-z]{4,}/g) || [],
    );
    const rank = (p: Product) =>
      (p.name + " " + p.description + " " + p.applications.join(" "))
        .toLowerCase()
        .split(/\W+/)
        .reduce((score, w) => score + (words.has(w) ? 1 : 0), 0);
    const candidates = eligible
      .sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))
      .slice(0, config.maxCandidates);
    await db.run(
      "UPDATE research_jobs SET candidates=? WHERE id=? AND lease=? AND status='running'",
      JSON.stringify(candidates),
      id,
      lease,
    );
    if (!(await live())) return;
    await reserve(db, job.company_id, config.dailyCalls);
    if (!(await phase("match_call"))) return;
    const matched = await provider.match(input, research, candidates);
    await usageEvent(db, job.company_id, id, "matching", matched.usage);
    const report = validateMatches(matched.report, research, candidates);
    const result = {
      ...report,
      coverage: {
        catalogTotal: total,
        examined: all.length,
        eligible: eligible.length,
        sentToModel: candidates.length,
        truncated: total > all.length || eligible.length > candidates.length,
      },
      opportunities: report.opportunities.map((o) => {
        const caution = evidenceCaution(report, o.sourceIds);
        return {
          ...o,
          evidenceCaution: caution,
          questions: caution
            ? [
                "Some cited evidence is historical or undated. Is the described process still used at the intended site?",
                ...o.questions,
              ].slice(0, 6)
            : o.questions,
          product: candidates.find((p) => p.id === o.productId),
        };
      }),
    };
    await db.run(
      "UPDATE research_jobs SET status='complete',phase='complete',result=?,lease_until=0,updated_at=? WHERE id=? AND lease=? AND status='running' AND lease_until>?",
      JSON.stringify(result),
      Date.now(),
      id,
      lease,
      Date.now(),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Research failed";
    // Provider bodies and keys are never included in errors. Unknown transport errors are summarized.
    const safe =
      /daily|AI |provider|source|product|structure|complete|JSON|Research/i.test(
        message,
      )
        ? message.slice(0, 500)
        : "Research failed or timed out. A chargeable call may have completed; retry explicitly after reviewing usage.";
    await db.run(
      "UPDATE research_jobs SET status='failed',error=?,lease_until=0,updated_at=? WHERE id=? AND lease=? AND status='running'",
      safe,
      Date.now(),
      id,
      lease,
    );
  }
}
export async function getResearch(
  db: Sql,
  p: Principal,
  id: string,
  config: Config,
) {
  const row = await db.get(
    "SELECT * FROM research_jobs WHERE company_id=? AND id=?",
    p.companyId,
    id,
  );
  if (!row) fail(404, "Research not found");
  const input = JSON.parse(row.input),
    research: ResearchArtifact | null = row.research
      ? JSON.parse(row.research)
      : null,
    result = row.result ? JSON.parse(row.result) : null;
  if (result)
    for (const opportunity of result.opportunities) {
      const current = await getProduct(db, p.companyId, opportunity.productId);
      opportunity.currentProduct = current;
      opportunity.currentEligibility = current
        ? eligibility(current, {
            region: input.region,
            maxAgeDays: config.staleDays,
          })
        : {
            eligible: false,
            reasons: ["Product removed from inventory"],
            availability: "unknown",
            regionVerified: false,
          };
      opportunity.catalogChanged = Boolean(
        !current ||
        JSON.stringify(current) !== JSON.stringify(opportunity.product),
      );
    }
  const reviews = (
    await db.all(
      "SELECT product_id AS productId,decision,answers,note,updated_at AS updatedAt FROM opportunity_reviews WHERE company_id=? AND job_id=?",
      p.companyId,
      id,
    )
  ).map((r) => ({ ...r, answers: JSON.parse(r.answers) }));
  const usage = await db.all(
    "SELECT phase,model,response_id AS responseId,input_tokens AS inputTokens,output_tokens AS outputTokens,search_calls AS searchCalls,created_at AS createdAt FROM usage_events WHERE company_id=? AND job_id=?",
    p.companyId,
    id,
  );
  return {
    id: row.id,
    status: row.status,
    phase: row.phase,
    input,
    research,
    result,
    reviews,
    usage,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function cancelResearch(db: Sql, p: Principal, id: string) {
  const changed = await db.run(
    "UPDATE research_jobs SET status='cancelled',updated_at=? WHERE company_id=? AND id=? AND status IN ('queued','running')",
    Date.now(),
    p.companyId,
    id,
  );
  if (!changed) fail(404, "Active research not found");
  await audit(db, p, "research.cancelled", { id });
}
export async function reviewOpportunity(
  db: Sql,
  p: Principal,
  id: string,
  productId: string,
  raw: any,
  staleDays = 30,
) {
  const row = await db.get(
    "SELECT result,input FROM research_jobs WHERE company_id=? AND id=? AND status='complete'",
    p.companyId,
    id,
  );
  if (
    !row ||
    !JSON.parse(row.result).opportunities.some(
      (o: any) => o.productId === productId,
    )
  )
    fail(404, "Opportunity not found");
  if (!raw || !["pending", "qualified", "rejected"].includes(raw.decision))
    fail(400, "Choose a review decision");
  const answers = Array.isArray(raw.answers)
    ? raw.answers
    : fail(400, "Supply answers as an array");
  if (
    answers.length > 6 ||
    answers.some((a: any) => typeof a !== "string" || a.length > 2000)
  )
    fail(400, "Invalid answers");
  const note = raw.note ? text(raw.note, "review note", 2000) : "";
  if (raw.decision === "qualified") {
    const current = await getProduct(db, p.companyId, productId);
    if (
      !current ||
      !eligibility(current, {
        region: JSON.parse(row.input).region,
        maxAgeDays: staleDays,
      }).eligible
    )
      fail(409, "Product is no longer eligible; refresh inventory first");
    if (!answers.some((a: string) => a.trim()) || !note)
      fail(400, "Qualification requires an answer and a review note");
  }
  await db.batch([
    {
      sql: "INSERT INTO opportunity_reviews VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(company_id,job_id,product_id) DO UPDATE SET decision=excluded.decision,answers=excluded.answers,note=excluded.note,user_id=excluded.user_id,updated_at=excluded.updated_at",
      args: [
        p.companyId,
        id,
        productId,
        raw.decision,
        JSON.stringify(answers),
        note,
        p.userId,
        Date.now(),
      ],
    },
    {
      sql: "INSERT INTO audit_events VALUES (?,?,?,?,?,?)",
      args: [
        crypto.randomUUID(),
        p.companyId,
        p.userId,
        "opportunity.reviewed",
        JSON.stringify({ id, productId, decision: raw.decision }),
        Date.now(),
      ],
    },
  ]);
}
