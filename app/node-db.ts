import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Sql, Row, Value, Statement } from "./db.js";
import { schema } from "./schema.js";
export class NodeDatabase implements Sql {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(schema);
  }
  async all<T extends Row = Row>(sql: string, ...args: Value[]): Promise<T[]> {
    return this.db.prepare(sql).all(...args) as T[];
  }
  async get<T extends Row = Row>(
    sql: string,
    ...args: Value[]
  ): Promise<T | undefined> {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  async run(sql: string, ...args: Value[]) {
    return Number(this.db.prepare(sql).run(...args).changes);
  }
  async batch(statements: Statement[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s) => {
        const rows = this.db.prepare(s.sql).all(...(s.args || []));
        const changes = Number(
          this.db.prepare("SELECT changes() AS n").get()!.n,
        );
        return { rows, changes };
      });
      this.db.exec("COMMIT");
      return results;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
