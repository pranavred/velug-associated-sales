import type { Sql, Row, Value, Statement } from "./db.js";
export class CloudDatabase implements Sql {
  constructor(private db: D1Database) {}
  async all<T extends Row = Row>(sql: string, ...args: Value[]): Promise<T[]> {
    return (
      await this.db
        .prepare(sql)
        .bind(...args)
        .all<T>()
    ).results;
  }
  async get<T extends Row = Row>(
    sql: string,
    ...args: Value[]
  ): Promise<T | undefined> {
    return (
      (await this.db
        .prepare(sql)
        .bind(...args)
        .first<T>()) ?? undefined
    );
  }
  async run(sql: string, ...args: Value[]) {
    return (
      await this.db
        .prepare(sql)
        .bind(...args)
        .run()
    ).meta.changes;
  }
  async batch(statements: Statement[]) {
    const results = await this.db.batch<Row>(
      statements.map((s) => this.db.prepare(s.sql).bind(...(s.args || []))),
    );
    return results.map((r) => ({ rows: r.results, changes: r.meta.changes }));
  }
}
