# india-tariffs

Versioned, provenance-tracked registry of India C&I (HT/LT industrial and commercial) electricity retail tariffs.

See [`../../docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md`](../../docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md) for the full strategy, domain model and rollout plan.

## Scope

This package owns tariff *data*: sources, provenance, normalized tariff records and compiled releases. It does not own bill calculation logic — that lives in [`../tariff-engine`](../tariff-engine).

## Structure

- `registry/` — jurisdictions, regulators, licensees, shared tariff groups, an unresolved-entity review queue, and monitored sources (human-reviewed YAML, source of truth; loaded into PostgreSQL via `crawler/`'s `registry-load` command). See [`../../docs/data/INDIA_LICENSEE_REGISTRY.md`](../../docs/data/INDIA_LICENSEE_REGISTRY.md) and [`../../docs/data/INDIA_TARIFF_SOURCE_REGISTRY.md`](../../docs/data/INDIA_TARIFF_SOURCE_REGISTRY.md) for the licensee tier/verification model and source health model, respectively.
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

## Reviewing extracted tariff candidates

Extracted candidate tariffs, their charges, page-level citations and
validation findings live across several normalized PostgreSQL tables
(`candidate_tariffs`, `candidate_charge_components`, `field_citations`,
`validation_results`) and are not practical to eyeball with ad hoc SQL.
`review-report` renders them as a single human-readable Markdown file,
grouped by candidate, with structural red flags (e.g. an ENERGY or DEMAND
charge that has a rebate/surcharge but no base rate to apply it against,
which is not billable — this exact pattern was found in a real KERC
extraction) called out at the top of each affected candidate rather than
left for the reader to notice:

```bash
APP_ENV=staging node dist/src/cli.js review-report --document <document_id> --out review.md
# or, to inspect a single candidate:
APP_ENV=staging node dist/src/cli.js review-report --candidate <id>
```

This is a stopgap for fast external inspection, not a review UI — a proper
reviewer workflow (accepting/rejecting candidates, recording a
`review_decisions` row) still needs to be built before any candidate can
reach `approved_tariffs`.

## Status

Wave 0/3 (Foundation / National coverage) — in progress. PostgreSQL
persistence, migrations, environment isolation (staging/production/test),
and an idempotent registry loader are implemented and exercised against a
real staging database. The jurisdiction/regulator/licensee registry now
covers all 36 states/UTs with an identified regulator and at least one
licensee each (30 regulators, 72 licensees, 23 authoritative sources, 4
shared-tariff-group records, 8 open review-queue items) — see
[`../../docs/data/INDIA_TARIFF_COVERAGE.md`](../../docs/data/INDIA_TARIFF_COVERAGE.md)
for exact counts, per-jurisdiction status and known gaps. No source has an
`ACTIVE` `monitoring_status` yet (source reachability has been live-probed,
but document-discovery crawl adapters have not been validated), and no
tariff order/schedule data has been extracted — no approved tariff records
exist yet.
