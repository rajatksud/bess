import { PrismaClient } from '@prisma/client';

let sharedClient: PrismaClient | undefined;

/**
 * Lazily creates the process-wide PrismaClient. Deliberately lazy (not created at
 * import time) so the existing stateless routes (simulation/run, tariff/calculate,
 * optimisation/run) never trigger a database connection attempt - they must keep
 * working even when DATABASE_URL is unset or the database is unreachable.
 */
export function getPrismaClient(): PrismaClient {
  if (!sharedClient) {
    sharedClient = new PrismaClient();
  }
  return sharedClient;
}
