import type { Sql } from "./db.js";
export interface WorkflowQueue {
  create(input: { id: string; params: { id: string } }): Promise<unknown>;
  get(id: string): Promise<{ status(): Promise<{ status: string }> }>;
}
export async function dispatchResearch(
  db: Sql,
  id: string,
  queue: WorkflowQueue,
) {
  try {
    await queue.create({ id, params: { id } });
  } catch (error) {
    let status: string;
    try {
      status = (await (await queue.get(id)).status()).status;
    } catch {
      throw error;
    }
    if (["complete", "errored", "terminated", "unknown"].includes(status))
      await db.run(
        "UPDATE research_jobs SET status='failed',error='Research dispatch ended before the job started. Start a new run explicitly.',updated_at=? WHERE id=? AND status='queued'",
        Date.now(),
        id,
      );
  }
}
export async function reconcileQueued(db: Sql, queue: WorkflowQueue) {
  const rows = await db.all(
    "SELECT id,created_at FROM research_jobs WHERE status='queued' AND created_at<? ORDER BY created_at LIMIT 25",
    Date.now() - 60000,
  );
  for (const row of rows) {
    try {
      await dispatchResearch(db, row.id, queue);
    } catch {
      if (row.created_at < Date.now() - 3600000)
        await db.run(
          "UPDATE research_jobs SET status='failed',error='Could not deliver research after repeated scheduling attempts. Start a new run.',updated_at=? WHERE id=? AND status='queued'",
          Date.now(),
          row.id,
        );
    }
  }
}
