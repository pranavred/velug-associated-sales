export type Row = Record<string, any>;
export type Value = string | number | null;
export type Statement = { sql: string; args?: Value[] };
export interface Sql {
  all<T extends Row = Row>(sql: string, ...args: Value[]): Promise<T[]>;
  get<T extends Row = Row>(sql: string, ...args: Value[]): Promise<T | undefined>;
  run(sql: string, ...args: Value[]): Promise<number>;
  /** Atomic, ordered, rollback-on-error. Every adapter must preserve this contract. */
  batch(statements: Statement[]): Promise<{ rows: Row[]; changes: number }[]>;
}
export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function fail(status: number, message: string): never { throw new AppError(status, message); }
export function text(value: unknown, name: string, max = 200, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) return fail(400, `Invalid ${name}`);
  return value.trim();
}
