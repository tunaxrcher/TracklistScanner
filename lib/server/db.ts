import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * Prisma access. DATABASE_URL is optional — without it the app keeps working
 * and per-user history simply falls back to browser localStorage.
 *
 * Schema changes go through migrations:
 *   npx prisma migrate dev --name <change>   (development)
 *   npx prisma migrate deploy                (server)
 */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

interface DbGlobal {
  __prisma?: PrismaClient;
}

const g = globalThis as unknown as DbGlobal;

/** Singleton Prisma client, surviving dev-server reloads. */
export function getDb(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  if (!g.__prisma) {
    const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
    g.__prisma = new PrismaClient({ adapter });
  }
  return g.__prisma;
}
