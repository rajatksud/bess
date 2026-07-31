# India Tariff Authoritative Source Registry

Companion reference to [`INDIA_TARIFF_COVERAGE.md`](INDIA_TARIFF_COVERAGE.md)
and [`INDIA_LICENSEE_REGISTRY.md`](INDIA_LICENSEE_REGISTRY.md), documenting
the source registry in `packages/india-tariffs/registry/sources.yaml`. See
`packages/india-tariffs/schemas/authoritative_source.schema.json` for the
field-level schema.

## Source authority hierarchy (used when field values conflict)

1. Commission tariff order, review order or corrigendum (`authority_rank: 1`).
2. Commission-approved tariff schedule (`authority_rank: 2`).
3. State Gazette or government duty/tax notification (`authority_rank: 3`).
4. Official distribution-licensee/department circular implementing an
   approved charge (`authority_rank: 4`).
5. Official bill calculator/format, used for validation only
   (`authority_rank: 5`).
6. Secondary summaries — discovery only, never a source of record
   (`authority_rank: 6`).

## Two distinct health concepts

- **`source_health`** — the result of an actual live reachability probe
  (WebFetch against the URL). `HEALTHY` requires a successful fetch that
  confirms the expected content, not just a 2xx status or a syntactically
  valid URL. `DEGRADED` means the domain is very likely correct but a clean
  fetch could not be completed. `BLOCKED` means no working domain was found.
  `NOT_CHECKED` means no probe has been attempted yet.
- **`monitoring_status`** — whether the crawler is actively configured to
  discover documents from this source. Every source in this registry
  (including all newly-added ones) is `NOT_CONFIGURED` regardless of
  `source_health` — moving to `ACTIVE` requires a separate crawl-adapter
  validation pass (confirming `include_patterns`/`exclude_patterns` and the
  chosen `discovery_method`/`adapter` actually find the right documents),
  which is out of scope for this registry-expansion pass.

Never conflate the two: a `HEALTHY` source is not automatically `ACTIVE`.

## Current inventory (23 sources)

| source_health | Count |
|---|---:|
| HEALTHY | 18 |
| BLOCKED | 1 (`MSEDCL-TARIFF-DETAILS` — seeded URL now 404s) |
| Not yet probed (pre-2026-07-31 seed entries) | 4 |

All 23 sources reference a valid `jurisdiction_code`, and every
`regulator_code`/`licensee_code`/`licensee_codes` reference resolves to a
real registry entry — enforced by
`crawler/tests/nationalRegistry.test.ts`. No source is orphaned (unscoped to
any regulator or licensee) except the intentionally discovery-only
`FOR-DIRECTORY` (Forum of Regulators directory), which the strategy document
explicitly designates as discovery-only, never a source of record.

## Live-probe evidence

Every `HEALTHY`/`DEGRADED`/`BLOCKED` source added or corrected on
2026-07-31 carries `last_verified`, `last_live_check_at`, and a `notes`
field documenting exactly what was fetched and what it showed (or why it
failed). See `registry/sources.yaml` directly for the per-source detail —
it is deliberately verbose rather than summarized here, since the specific
probe evidence (which domain variant worked, what error a failed one
returned) is the operative fact for whoever picks up the next crawl-adapter
validation pass.

## Known regression

`MSEDCL-TARIFF-DETAILS` (`https://www.mahadiscom.in/consumer/en/tariff-details/`),
present in the registry since before this expansion pass, now returns
HTTP 404. MSEDCL has evidently restructured its site. Recorded
`source_health: BLOCKED` rather than left looking healthy; needs a fresh URL
discovery pass (not just a retry) before it can move off `BLOCKED`.

## Remaining work before any source reaches ACTIVE monitoring_status

1. Re-probe the 13 DEGRADED/BLOCKED/NOT_CHECKED regulator sources (see
   `INDIA_TARIFF_COVERAGE.md`'s regulator health table) — several are very
   likely just JS-rendering or bot-detection artifacts of the automated
   fetch environment (UPERC, KSERC, MPERC, HERC) rather than genuinely dead
   sites, based on corroborating search-indexed content.
2. For each HEALTHY source, run an actual crawl-adapter pass to confirm
   `include_patterns`/`exclude_patterns` correctly isolate tariff documents
   from petitions/public notices before flipping `monitoring_status` to
   `ACTIVE`.
3. Discover a fresh MSEDCL tariff-details URL to replace the now-dead one.
4. Systematically expand Tier B source coverage (deemed/SEZ/industrial-area
   licensee sources) — only incidental Tier B sources exist today.
