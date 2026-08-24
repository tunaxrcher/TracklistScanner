// Prisma CLI configuration (migrations, generate). The runtime app connects
// through the driver adapter in lib/server/db.ts instead.
// The CLI reads .env (not .env.local), so DATABASE_URL lives in .env.
import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * The CLI speaks TLS through URL params (unlike the runtime driver adapter,
 * which takes a config object — see lib/server/db.ts). When DATABASE_CA_CERT
 * is set (managed databases, e.g. DigitalOcean), attach it here so
 * `prisma migrate deploy` can verify the server certificate too.
 */
function cliDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? "";
  const ca = process.env.DATABASE_CA_CERT;
  if (!raw || !ca) return raw;
  const url = new URL(raw);
  url.searchParams.set("sslcert", ca);
  url.searchParams.set("sslaccept", "strict");
  return url.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: cliDatabaseUrl(),
  },
});
