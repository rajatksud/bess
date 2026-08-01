#!/usr/bin/env node
// Composes a Prisma DATABASE_URL from this repo's existing discrete DB_STG_*/DB_PROD_*
// env vars (bess-calc/.env), since the app has no dotenv dependency and Prisma's CLI
// expects a single connection string. Never prints the composed URL (it contains a
// password) — only used to set process.env.DATABASE_URL for a child process.
//
// Usage: node scripts/composeDatabaseUrl.mjs <staging|prod> <admin|app> -- <command...>
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

const [, , target, role, sep, ...commandParts] = process.argv;

if (!['staging', 'prod'].includes(target) || !['admin', 'app'].includes(role) || sep !== '--' || commandParts.length === 0) {
  console.error('Usage: node scripts/composeDatabaseUrl.mjs <staging|prod> <admin|app> -- <command...>');
  process.exit(1);
}

const fileVars = loadEnvFile(envPath);
const env = { ...fileVars, ...process.env };

const prefix = target === 'staging' ? 'DB_STG' : 'DB_PROD';
const userKey = role === 'admin' ? `${prefix}_ADMIN_USER` : `${prefix}_USER`;
const passwordKey = role === 'admin' ? `${prefix}_ADMIN_PASSWORD` : `${prefix}_PASSWORD`;

const host = env[`${prefix}_HOST`];
const port = env[`${prefix}_PORT`];
const name = env[`${prefix}_NAME`];
const user = env[userKey];
const password = env[passwordKey];

const missing = Object.entries({ host, port, name, user, password })
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  console.error(`Missing required env vars for ${target}/${role}: ${missing.join(', ')} (checked ${envPath} and process.env)`);
  process.exit(1);
}

const databaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;

// Resolve local binaries directly (node_modules/.bin) instead of shelling out to
// npx/npm, so we know exactly which file runs rather than trusting PATH resolution.
// On Windows, node_modules/.bin/*.cmd shims are themselves batch scripts and can only
// be executed through cmd.exe, so shell:true is unavoidable there - but the only
// value ever placed in argv is this hardcoded, resolved .cmd path plus static command
// names (e.g. "migrate", "deploy"); DATABASE_URL (which embeds the DB password) is
// passed via env, never via argv or string-concatenated into the command line, so
// there is nothing attacker-controlled for cmd.exe's quoting rules to mis-parse.
function resolveBin(name) {
  const binDir = join(__dirname, '..', 'node_modules', '.bin');
  if (process.platform === 'win32') {
    const cmdPath = join(binDir, `${name}.cmd`);
    if (existsSync(cmdPath)) return cmdPath;
  }
  return join(binDir, name);
}

const [firstCommand, ...restArgs] = commandParts;
const resolvedCommand = firstCommand === 'npx' ? resolveBin(restArgs[0]) : resolveBin(firstCommand);
// __DATABASE_URL__ is a placeholder token, never the real secret, on the command line
// this script is invoked with - it's substituted here, right before spawning, so the
// real URL (with its embedded password) never appears in shell history or in any
// command this script was actually called with.
const resolvedArgs = (firstCommand === 'npx' ? restArgs.slice(1) : restArgs)
  .map(arg => (arg === '__DATABASE_URL__' ? databaseUrl : arg));

const child = spawn(resolvedCommand, resolvedArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...env, DATABASE_URL: databaseUrl }
});

child.on('exit', (code) => process.exit(code ?? 1));
