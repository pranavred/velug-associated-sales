const fs = require("node:fs"),
  { spawnSync } = require("node:child_process");
const remote = process.argv.includes("--remote");
for (const o of JSON.parse(
  fs.readFileSync("data/cloud/objects.json", "utf8"),
)) {
  const pdf = fs.readFileSync(o.path).subarray(0, 5).toString() === "%PDF-";
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "r2",
      "object",
      "put",
      "plant-intelligence-evidence/" + o.key,
      "--file",
      o.path,
      "--content-type",
      pdf ? "application/pdf" : "application/octet-stream",
      remote ? "--remote" : "--local",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(result.stderr, result.stdout);
    process.exit(1);
  }
  console.log("Uploaded " + o.key);
}
