import { readFileSync } from "fs";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * Prisma access. DATABASE_URL is optional — without it the app keeps working
 * and per-user history simply falls back to browser localStorage.
 *
 * Managed databases (e.g. DigitalOcean) require TLS with their own CA: point
 * DATABASE_CA_CERT at the downloaded ca-certificate.crt and the connection is
 * made over verified TLS. Without it, a plain connection string is used.
 *
 * Schema changes go through migrations:
 *   npx prisma migrate dev --name <change>   (development)
 *   npx prisma migrate deploy                (server)
 */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function makeAdapter(databaseUrl: string): PrismaMariaDb {
  const caPath = process.env.DATABASE_CA_CERT;
  if (!caPath) return new PrismaMariaDb(databaseUrl);

  // The mariadb driver can't take a CA file via URL params, so with a CA we
  // hand it a config object instead of the connection string.
  const u = new URL(databaseUrl);
  return new PrismaMariaDb({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true },
  });
}

interface DbGlobal {
  __prisma?: PrismaClient;
}

const g = globalThis as unknown as DbGlobal;

/** Singleton Prisma client, surviving dev-server reloads. */
export function getDb(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  if (!g.__prisma) {
    g.__prisma = new PrismaClient({ adapter: makeAdapter(process.env.DATABASE_URL) });
  }
  return g.__prisma;
}
