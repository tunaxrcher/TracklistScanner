// Dev helper: mint a short-lived session token from AUTH_SECRET in .env
// so API smoke tests can run without a Google sign-in. Prints the token.
//   node scripts/mint-test-session.js
import fs from "fs";
import crypto from "crypto";

const env = fs.readFileSync(".env", "utf8");
const match = env.match(/^AUTH_SECRET=(.*)$/m);
if (!match) throw new Error("AUTH_SECRET not found in .env");
const secret = match[1].trim().replace(/^["']|["']$/g, "");

const payload = JSON.stringify({
  email: "smoke@test.local",
  exp: Math.floor(Date.now() / 1000) + 600,
});
const sig = crypto.createHmac("sha256", secret).update(payload).digest();
console.log(Buffer.from(payload).toString("base64url") + "." + sig.toString("base64url"));
