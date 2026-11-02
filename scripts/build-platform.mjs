import { cp, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
execFileSync(
  "node",
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.app.json"],
  { stdio: "inherit" },
);
await mkdir("dist/app/public", { recursive: true });
await cp("app/public", "dist/app/public", { recursive: true });
