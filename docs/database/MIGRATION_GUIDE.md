# Migration Guide

## Environments

Both staging and prod PostgreSQL databases are **pre-provisioned
infrastructure**, not created by this project — a database named `bess`
(owned by role `bess_admin`) already exists on both hosts.

| Environment | Host                          | How it's reached                          | Local port (via existing SSH tunnel) |
| ----------- | ------------------------------ | ------------------------------------------ | ------------------------------------- |
| Staging     | `prjx1` (standalone Postgres)  | Direct                                      | `localhost:5433`                      |
| Prod        | `prjx6` (Patroni HA cluster)   | Via HAProxy primary endpoint (port 5000)    | `localhost:15433`                     |

**Never connect directly to a Patroni cluster node.** Always go through the
HAProxy port — the cluster can fail over to a different node at any time,
and only HAProxy's primary listener (5000) is guaranteed to route to
whichever node currently holds the write lock.

Both SSH tunnels are expected to already be running as long-lived local
processes (`ssh -L 5433:127.0.0.1:5432 prjx1` and a tunnel to `prjx6`
including `-L 15433:127.0.0.1:5000`). This project does not open or manage
these tunnels itself — if a migration command times out connecting, check
the tunnel is up before troubleshooting anything else.

## Credentials

`bess-calc/.env` (gitignored, never committed) holds discrete connection
parts rather than a single `DATABASE_URL`:

```
DB_STG_HOST / DB_STG_PORT / DB_STG_NAME / DB_STG_ADMIN_USER / DB_STG_ADMIN_PASSWORD / DB_STG_USER / DB_STG_PASSWORD
DB_PROD_HOST / DB_PROD_PORT / DB_PROD_NAME / DB_PROD_ADMIN_USER / DB_PROD_ADMIN_PASSWORD / DB_PROD_USER / DB_PROD_PASSWORD
```

`scripts/composeDatabaseUrl.mjs` composes a Prisma-compatible
`DATABASE_URL` from these at invocation time and passes it to a child
process via environment variable only (never printed, never placed in
argv). Usage:

```
node scripts/composeDatabaseUrl.mjs <staging|prod> <admin|app> -- <command...>
```

- Use `admin` for anything that changes schema (`prisma migrate deploy`,
  `prisma migrate status`, `prisma db pull`).
- Use `app` for whatever the running server itself connects with — the
  server reads `DATABASE_URL` directly from its own environment (see
  `.env.example`); this script's `app` mode is only for local manual
  testing against the same least-privilege credential the app uses.

## Provisioning the application role

Migrations run as `*_ADMIN_USER`; the running application connects as
`*_USER` (least privilege — no schema-altering rights). If the `*_USER`
role doesn't exist yet on an environment, create it and grant it
CRUD-only access via `sql/grant_bess_user_privileges.sql` in this
directory (run as the admin role, e.g.
`sudo -u postgres psql -d bess -f sql/grant_bess_user_privileges.sql`
after `CREATE ROLE bess_user LOGIN PASSWORD '<from .env>';`).

## Running a migration

Migrations are authored once (see "Authoring a new migration" below), then
applied to staging first, verified, then applied to prod:

```bash
# 1. Apply to staging
npm run db:migrate:staging

# 2. Verify
npm run db:status:staging

# 3. Only after staging looks correct, apply the identical migration to prod
npm run db:migrate:prod
npm run db:status:prod
```

`prisma migrate deploy` is used in both cases — never `prisma migrate dev`.
`migrate dev` requires shadow-database creation privileges (`CREATE
DATABASE`), which the `bess_admin` role on this shared cluster does not
have (confirmed: attempting it fails with `P3014 permission denied to
create database`), and more importantly, `migrate dev` is an interactive,
divergence-resolving command not meant for shared or production databases.
`migrate deploy` only ever applies already-committed, already-reviewed
migration files — nothing is generated or altered on the fly.

## Authoring a new migration

Since `migrate dev` isn't available against these databases, generate
migration SQL via schema diffing instead:

```bash
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<timestamp>_<name>/migration.sql
```

For an *incremental* change (not the initial migration), diff from the
current migrations directory instead of `--from-empty`:

```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<timestamp>_<name>/migration.sql
```

Review the generated SQL by hand before committing it — Prisma's diff
output is a strong starting point, not a substitute for reading exactly
what will run against a shared database.

## Safety rules

- **Additive and reversible only.** No `DROP TABLE`, `DROP COLUMN`, or
  `DROP SCHEMA` in any migration without an explicit, separate, reviewed
  decision — this guide's default is additive-only.
- **Never experiment directly against prod.** Every migration is verified
  against staging first, with no exceptions.
- **Rollback approach:** because migrations are additive, "rolling back" a
  bad migration means writing and applying a new migration that drops
  exactly the objects the bad migration added (never a blanket reset or
  `migrate reset`, which would wipe the whole database). If a migration is
  caught before being applied to prod, the fix is simpler: delete the
  migration folder and re-diff.
- **Credentials never leave environment variables.** No script in this
  repo prints, logs, or writes `DATABASE_URL` or any `*_PASSWORD` value to
  disk, stdout, or a commit.

## Local application development

The running server (via `npm run dev:server` or the built `server-dist/`)
reads `DATABASE_URL` directly from its environment — set it in a local
(gitignored) `.env` using the `*_USER`/`*_PASSWORD` (not `*_ADMIN_*`) pair
for whichever environment you're pointing at, or compose it ad hoc:

```bash
node scripts/composeDatabaseUrl.mjs staging app -- npm run dev:server
```
