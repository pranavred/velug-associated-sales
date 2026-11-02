import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { plants, sources } from "./seeds.js";
export const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
export type Segment = { locator: string; text: string };
export class Store {
  db: DatabaseSync;
  dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, "research.sqlite"));
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS changes(id INTEGER PRIMARY KEY,source TEXT,before_version TEXT,after_version TEXT,at TEXT);
 CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY,kind TEXT,target TEXT,decision TEXT,reviewer TEXT,note TEXT,at TEXT);
 CREATE TABLE IF NOT EXISTS api_budget(day TEXT PRIMARY KEY,calls INTEGER NOT NULL);
 PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS plants(id TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,plant TEXT,title TEXT,url TEXT,hours REAL,approved INTEGER DEFAULT 1,last_checked TEXT,last_changed TEXT,version TEXT,error TEXT,UNIQUE(plant,url));
 CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,source TEXT,fetched_at TEXT,final_url TEXT,raw_path TEXT,segments TEXT);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at TEXT,kind TEXT,subject TEXT,detail TEXT);
 CREATE TABLE IF NOT EXISTS profiles(id INTEGER PRIMARY KEY,plant TEXT,at TEXT,fingerprint TEXT,json TEXT,UNIQUE(plant,fingerprint));
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,next_at INTEGER DEFAULT 0,lease_until INTEGER DEFAULT 0,token TEXT,failures INTEGER DEFAULT 0,status TEXT DEFAULT 'pending',error TEXT);
 `);
  }
  all(sql: string, ...args: any[]): any[] {
    return this.db.prepare(sql).all(...args);
  }
  get(sql: string, ...args: any[]): any {
    return this.db.prepare(sql).get(...args);
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  seed() {
    for (const p of plants)
      this.run(
        "INSERT OR IGNORE INTO plants VALUES (?,?)",
        p.id,
        JSON.stringify(p),
      );
    for (const s of sources)
      this.run(
        "INSERT OR IGNORE INTO sources(id,plant,title,url,hours) VALUES (?,?,?,?,?)",
        s.id,
        s.plant,
        s.title,
        s.url,
        s.hours,
      );
  }
  event(kind: string, subject: string, detail: string) {
    this.run(
      "INSERT INTO events(at,kind,subject,detail) VALUES (?,?,?,?)",
      new Date().toISOString(),
      kind,
      subject,
      detail,
    );
  }
  claim(id: string, now = Date.now(), force = false): string | null {
    this.run("INSERT OR IGNORE INTO jobs(id) VALUES (?)", id);
    const token = randomUUID();
    const r = this.run(
      "UPDATE jobs SET lease_until=?,token=?,status='running' WHERE id=? AND lease_until<=? AND (next_at<=? OR ?=1)",
      now + 120000,
      token,
      id,
      now,
      now,
      force ? 1 : 0,
    );
    return r.changes ? token : null;
  }
  heartbeat(id: string, token: string) {
    this.run(
      "UPDATE jobs SET lease_until=? WHERE id=? AND token=?",
      Date.now() + 120000,
      id,
      token,
    );
  }
  finish(id: string, token: string, hours: number, error?: string) {
    const j = this.get("SELECT * FROM jobs WHERE id=? AND token=?", id, token);
    if (!j) return;
    const failures = error ? j.failures + 1 : 0;
    const wait = error
      ? Math.min(24 * 3600000, 300000 * 2 ** Math.min(failures - 1, 8))
      : hours * 3600000;
    this.run(
      "UPDATE jobs SET next_at=?,lease_until=0,token=NULL,failures=?,status=?,error=? WHERE id=? AND token=?",
      Date.now() + wait,
      failures,
      error ? "failed" : "ok",
      error ?? null,
      id,
      token,
    );
  }
  reserveCall(limit: number, day = new Date().toISOString().slice(0, 10)) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("Daily model-call limit must be a positive integer");
    return Boolean(
      this.get(
        "INSERT INTO api_budget(day,calls) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1 WHERE calls<? RETURNING calls",
        day,
        limit,
      ),
    );
  }
  review(
    kind: string,
    target: string,
    decision: string,
    reviewer: string,
    note: string,
  ) {
    if (!reviewer.trim() || !note.trim())
      throw new Error("A reviewer and reason are required");
    if (reviewer.length > 120 || note.length > 2000)
      throw new Error("Review text too long");
    if (kind === "claim") {
      const [profileId, claimId] = target.split(":");
      const row = this.get("SELECT json FROM profiles WHERE id=?", profileId);
      if (
        !row ||
        !JSON.parse(row.json).claims.some((c: any) => c.id === claimId)
      )
        throw new Error("Unknown claim");
      if (!["supported", "unsupported", "uncertain"].includes(decision))
        throw new Error("Invalid claim decision");
    } else if (kind === "change") {
      if (!this.get("SELECT id FROM changes WHERE id=?", target))
        throw new Error("Unknown change");
      if (!["meaningful", "not_meaningful", "uncertain"].includes(decision))
        throw new Error("Invalid change decision");
    } else throw new Error("Unknown review kind");
    this.run(
      "INSERT INTO reviews(kind,target,decision,reviewer,note,at) VALUES (?,?,?,?,?,?)",
      kind,
      target,
      decision,
      reviewer.trim(),
      note.trim(),
      new Date().toISOString(),
    );
    this.event(
      "review_recorded",
      kind + ":" + target,
      decision + " by " + reviewer.trim(),
    );
  }
  close() {
    this.db.close();
  }
}
export async function job(
  store: Store,
  id: string,
  hours: number,
  fn: () => Promise<void>,
  force = false,
) {
  const token = store.claim(id, Date.now(), force);
  if (!token) return false;
  const timer = setInterval(() => store.heartbeat(id, token), 30000);
  timer.unref();
  try {
    await fn();
    store.finish(id, token, hours);
    store.event("job_ok", id, "Completed");
  } catch (e) {
    const message = String(e);
    store.finish(id, token, hours, message);
    store.event("job_failed", id, message);
    throw e;
  } finally {
    clearInterval(timer);
  }
  return true;
}
