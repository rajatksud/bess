#!/usr/bin/env node
// Read-only database identity check. Run this BEFORE any migration.
//
// Usage: node scripts/dbIdentityCheck.mjs <staging|prod> [admin|app]
//
// Why this exists: in this deployment DB_STG_* and DB_PROD_* differ ONLY by port —
// same host (localhost, i.e. an SSH-forwarded tunnel), same database name, same user
// names. Nothing in the connection string distinguishes staging from production, so the
// only reliable way to know which server you are actually about to migrate is to ask the
// server itself.
//
// Executes SELECTs only. Never prints a password, and never prints the composed URL.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');

function loadEnvFile(path) {
  const vars = {};
  if (!existsSync(path)) return vars;
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

const [, , target, role = 'app'] = process.argv;
if (!['staging', 'prod'].includes(target) || !['admin', 'app'].includes(role)) {
  console.error('Usage: node scripts/dbIdentityCheck.mjs <staging|prod> [admin|app]');
  process.exit(1);
}

const env = { ...loadEnvFile(envPath), ...process.env };
const prefix = target === 'staging' ? 'DB_STG' : 'DB_PROD';
const user = env[role === 'admin' ? `${prefix}_ADMIN_USER` : `${prefix}_USER`];
const password = env[role === 'admin' ? `${prefix}_ADMIN_PASSWORD` : `${prefix}_PASSWORD`];
const host = env[`${prefix}_HOST`];
const port = env[`${prefix}_PORT`];
const name = env[`${prefix}_NAME`];

const missing = Object.entries({ host, port, name, user, password }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  console.error(`Missing required env vars for ${target}/${role}: ${missing.join(', ')}`);
  process.exit(1);
}

const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  const [identity] = await prisma.$queryRawUnsafe(`
    SELECT version()                        AS server_version,
           current_database()               AS current_database,
           current_user                     AS current_user_name,
           pg_is_in_recovery()              AS is_in_recovery,
           inet_server_port()               AS server_port,
           COALESCE(host(inet_server_addr()), 'local-socket') AS server_addr,
           pg_postmaster_start_time()::text  AS postmaster_start_time
  `);

  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);

  console.log(`target:              ${target} (role: ${role})`);
  console.log(`connected via:       ${host}:${port}`);
  console.log(`server_version:      ${identity.server_version}`);
  console.log(`current_database:    ${identity.current_database}`);
  console.log(`current_user:        ${identity.current_user_name}`);
  console.log(`pg_is_in_recovery:   ${identity.is_in_recovery}`);
  console.log(`server_addr:port:    ${identity.server_addr}:${identity.server_port}`);
  console.log(`postmaster_start:    ${identity.postmaster_start_time}`);
  console.log(`public tables (${tables.length}): ${tables.map(t => t.table_name).join(', ') || '(none)'}`);

  if (identity.is_in_recovery === true) {
    console.error('\nABORT: this server is a REPLICA (pg_is_in_recovery() = true). Do not migrate it.');
    process.exit(2);
  }
  console.log('\nOK: primary server, not a replica.');
} finally {
  await prisma.$disconnect();
}
