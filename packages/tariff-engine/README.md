# tariff-engine

Category resolution, billing rules and bill calculation logic for India C&I electricity tariffs.

See [`../../docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md`](../../docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md) for the full strategy.

## Scope

This package owns tariff *calculation logic*: category/tariff resolution, billing-demand rules, time-band evaluation and bill reconstruction. It consumes approved, versioned releases published by [`../india-tariffs`](../india-tariffs) — it must never scrape sources or read unapproved crawler output directly (section 10).

## Structure

- `src/` — resolver, billing-demand rule engine, time-band engine, bill calculator.
- `tests/` — unit tests and golden-bill regression fixtures.

## Status

Wave 0 (Foundation) — scaffold only. No resolver or calculator implementation yet.
