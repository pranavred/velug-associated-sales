import { NodeDatabase } from "./node-db.js";
import { bootstrap } from "./auth.js";
const db = new NodeDatabase(
  process.env.DATABASE_PATH || "data/platform.sqlite",
);
try {
  if (!process.env.BOOTSTRAP_EMAIL || !process.env.BOOTSTRAP_PASSWORD)
    throw Error(
      "Set BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD (14+ characters), and BOOTSTRAP_COMPANY in your private environment.",
    );
  await bootstrap(db, {
    email: process.env.BOOTSTRAP_EMAIL,
    password: process.env.BOOTSTRAP_PASSWORD,
    company: process.env.BOOTSTRAP_COMPANY || "My company",
  });
  console.log(
    "Company owner created. Remove BOOTSTRAP_PASSWORD from your environment.",
  );
} finally {
  db.close();
}
