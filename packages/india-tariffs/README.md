# india-tariffs

Versioned, provenance-tracked registry of India C&I (HT/LT industrial and commercial) electricity retail tariffs.

See [`../../docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md`](../../docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md) for the full strategy, domain model and rollout plan.

## Scope

This package owns tariff *data*: sources, provenance, normalized tariff records and compiled releases. It does not own bill calculation logic — that lives in [`../tariff-engine`](../tariff-engine).

## Structure

- `registry/` — jurisdictions, regulators, licensees and monitored sources (human-reviewed YAML, source of truth; loaded into PostgreSQL via `crawler/`'s `registry-load` command).
- `schemas/` — JSON Schema definitions for registry, tariff, charge, time-band and provenance records.
- `data/normalized/` — human-reviewed, schema-validated tariff records (source of truth).
- `data/reference/` — supporting reference data (archetypes, taxonomies, etc.).
- `coverage/` — per-jurisdiction/licensee coverage status (see also [`../../docs/data/INDIA_TARIFF_COVERAGE.md`](../../docs/data/INDIA_TARIFF_COVERAGE.md)).
- `crawler/` — source monitoring, discovery, fetch, PostgreSQL persistence and migrations (`crawler/src/db/`).
- `Dockerfile` — production image (build context is this directory, `packages/india-tariffs/`).
- `compiler/` — compiles reviewed records into immutable, versioned releases (JSON/Parquet/CSV). Not yet implemented.
- `tests/` — schema, referential, temporal, commercial and golden-bill validation tests (crawler-side tests live in `crawler/tests/`).

## Database

The crawler persists all operational state (registry, crawl runs, fetched
documents, classification/extraction candidates, validation results) in
PostgreSQL, not in files or an in-memory store. See
[`crawler/src/db/`](crawler/src/db/) and
[`../../docs/operations/TARIFF_CRAWLER_DEPLOYMENT_PRJXN2.md`](../../docs/operations/TARIFF_CRAWLER_DEPLOYMENT_PRJXN2.md).

Quick start against a local/staging Postgres instance:

```bash
cd crawler
npm install
cp ../../../.env.example ../../../.env   # fill in real staging values
npm run build
APP_ENV=staging node dist/src/cli.js migrate
APP_ENV=staging node dist/src/cli.js registry-load
APP_ENV=staging node dist/src/cli.js source-health
```

## Status

Wave 0 (Foundation) — in progress. PostgreSQL persistence, migrations,
environment isolation (staging/production/test), and an idempotent registry
loader are implemented and exercised against a real staging database. The
jurisdiction/regulator/licensee registry has been expanded to cover all 36
states/UTs and 18 priority-state regulators/licensees (see
[`../../docs/data/INDIA_TARIFF_COVERAGE.md`](../../docs/data/INDIA_TARIFF_COVERAGE.md)
for exact counts and known gaps). The authoritative source registry (only 5
entries) has not yet been expanded to match, and no source has been through
a live verification crawl — no approved tariff records exist yet.
