import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
const out = "data/cloud";
mkdirSync(out, { recursive: true });
const quote = (v: unknown) =>
  v === null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : "'" + String(v).replaceAll("'", "''") + "'";
const manifest: any[] = [];
for (const mode of ["live", "demo"]) {
  const db = new DatabaseSync(`data/${mode}/research.sqlite`, {
    readOnly: true,
  });
  const tables = db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as any[];
  const sql: string[] = [];
  for (const t of tables) {
    sql.push(
      t.sql.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ") + ";",
    );
    const rows = db.prepare(`SELECT * FROM ${t.name}`).all() as any[];
    for (const row of rows) {
      if (t.name === "versions") {
        const key = `${mode}/${row.id}`;
        manifest.push({ mode, key, path: row.raw_path, id: row.id });
        row.raw_path = key;
      }
      if (t.name === "jobs") {
        row.lease_until = 0;
        row.token = null;
        if (row.status === "running") row.status = "pending";
      }
      const large = Object.entries(row).filter(
        ([, value]) => typeof value === "string" && value.length > 12000,
      ) as [string, string][];
      const initial = { ...row };
      for (const [key] of large) initial[key] = "";
      sql.push(
        `INSERT OR IGNORE INTO ${t.name} (${Object.keys(initial).join(",")}) VALUES (${Object.values(initial).map(quote).join(",")});`,
      );
      for (const [key, value] of large) {
        const chars = Array.from(value);
        for (let offset = 0; offset < chars.length; offset += 12000) {
          const chunk = chars.slice(offset, offset + 12000).join("");
          sql.push(
            `UPDATE ${t.name} SET ${key}=${key}||${quote(chunk)} WHERE id=${quote(row.id)} AND length(${key})=${offset};`,
          );
        }
      }
    }
  }
  writeFileSync(`${out}/${mode}.sql`, sql.join("\n"));
  db.close();
}
writeFileSync(`${out}/objects.json`, JSON.stringify(manifest, null, 2));
console.log(
  `Prepared both databases and ${manifest.length} evidence files. Credentials excluded.`,
);
