import { NodeDatabase } from "./node-db.js";
import { passwordHash, emailAddress } from "./auth.js";
if (process.argv[2] !== "reset-password")
  throw Error(
    "Usage: node dist/app/admin.js reset-password. Set ADMIN_USER_EMAIL and ADMIN_NEW_PASSWORD in the private environment.",
  );
const email = emailAddress(process.env.ADMIN_USER_EMAIL),
  password = await passwordHash(process.env.ADMIN_NEW_PASSWORD || "");
const db = new NodeDatabase(
  process.env.DATABASE_PATH || "data/platform.sqlite",
);
try {
  const user = await db.get("SELECT id FROM users WHERE email=?", email);
  if (!user) throw Error("User not found");
  await db.batch([
    {
      sql: "UPDATE users SET password=? WHERE id=?",
      args: [password, user.id],
    },
    { sql: "DELETE FROM sessions WHERE user_id=?", args: [user.id] },
  ]);
  console.log(
    "Password reset; all sessions for this account revoked. Remove ADMIN_NEW_PASSWORD from your environment.",
  );
} finally {
  db.close();
}
