# india-tariffs

Versioned, provenance-tracked registry of India C&I (HT/LT industrial and commercial) electricity retail tariffs.

See [`../../docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md`](../../docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md) for the full strategy, domain model and rollout plan.

## Scope

This package owns tariff *data*: sources, provenance, normalized tariff records and compiled releases. It does not own bill calculation logic — that lives in [`../tariff-engine`](../tariff-engine).

## Structure

- `registry/` — jurisdictions, regulators, licensees and monitored sources.
- `schemas/` — JSON Schema definitions for registry, tariff, charge, time-band and provenance records.
- `data/normalized/` — human-reviewed, schema-validated tariff records (source of truth).
- `data/reference/` — supporting reference data (archetypes, taxonomies, etc.).
- `coverage/` — per-jurisdiction/licensee coverage status.
- `crawler/` — source monitoring, discovery, extraction pipeline.
- `compiler/` — compiles reviewed records into immutable, versioned releases (JSON/Parquet/CSV).
- `tests/` — schema, referential, temporal, commercial and golden-bill validation tests.

## Status

Wave 0 (Foundation) — scaffold only. No approved tariff records yet.
