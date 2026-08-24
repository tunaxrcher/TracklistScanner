// Prisma CLI configuration (migrations, generate). The runtime app connects
// through the driver adapter in lib/server/db.ts instead.
// The CLI reads .env (not .env.local), so DATABASE_URL lives in .env.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
