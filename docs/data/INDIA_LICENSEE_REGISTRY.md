# India Distribution Licensee Registry

Companion reference to [`INDIA_TARIFF_COVERAGE.md`](INDIA_TARIFF_COVERAGE.md),
documenting the licensee classification model and tier definitions used in
`packages/india-tariffs/registry/licensees.yaml`. See
`packages/india-tariffs/schemas/licensee.schema.json` for the authoritative
field-level schema.

## Coverage tiers

| Tier | Meaning | Count |
|---|---|---:|
| **Tier A** | Mainstream distribution licensee: state-owned DISCOM/electricity department, major private licensee, municipal licensee, or successor of a restructured/merged entity — the ordinary route through which most Indian C&I consumers receive retail electricity. | 70 |
| **Tier B** | Extended C&I coverage: deemed licensees, SEZ/industrial-park/port/airport-area licensees, campus/township licensees, parallel/overlapping licensees. | 1 |
| **Tier C** | Historical or uncertain: renamed/merged/surrendered licensees, former electricity boards, entities without confirmed current status. Never presented as active regardless of how the entity is labeled elsewhere. | 1 |

Tier B is intentionally thin in this pass — only `DNHDDPCL` (Dadra & Nagar
Haveli / Daman & Diu's transmission-only entity, included for disambiguation
against the similarly-named distribution licensee) surfaced during research.
Systematic Tier B discovery (deemed licensees, SEZ/industrial-park licensees
etc.) beyond what appeared incidentally is a remaining gap — see
`INDIA_TARIFF_COVERAGE.md`'s gap list.

## Verification status

| Status | Meaning |
|---|---|
| `VERIFIED` | Confirmed against a source in the section-4 authoritative hierarchy (commission order/schedule, government notification, or the licensee's own site, fetched directly). |
| `PROVISIONAL` | Discovered and corroborated (typically via search-engine snippets or a secondary/financial-press source) but not yet confirmed by a direct fetch of a primary source. |
| `UNVERIFIED` | Not yet independently checked in this pass (the pre-existing Wave-1 seeding default). |
| `DISPUTED` | Conflicting authoritative evidence found. (Not currently used — no conflicts were found that couldn't be resolved to a single best-evidence answer, only genuine open questions, which go to the review queue instead.) |

23 of 72 licensees are `VERIFIED` (all from the 2026-07-31 research pass,
which prioritized direct-fetch confirmation over search corroboration where
possible). The remaining 49 are the pre-existing Wave-1 seed data (marked
`UNVERIFIED` in free-text notes prior to this pass; `status` was corrected
from `ACTIVE` to `UNCERTAIN` for the 43 of those that carried no evidence
pointer at all — see the national registry validation tests).

## Status field: ACTIVE vs. UNCERTAIN vs. INACTIVE

`status: ACTIVE` is reserved for licensees with at least one evidence
pointer (`evidence_url`, `website`, or `authoritative_source_ids`) — this is
enforced by `crawler/tests/nationalRegistry.test.ts`, not just a convention.
A licensee believed to be active based on general knowledge but not yet
independently confirmed is `UNCERTAIN`, never `ACTIVE`. `INACTIVE` is used
for confirmed-superseded entities (e.g. `EWEDC`, Chandigarh's pre-
privatization government department).

## Classification distinctions maintained in this registry

Per the mission's classification rules, the following are **not** treated
as independent distribution licensees even when closely related to one:

- **Holding companies** (e.g. Gujarat's GUVNL, Manipur's MSPCL, Meghalaya's
  MeECL) are excluded — only their operating distribution subsidiaries are
  registered.
- **Generation/transmission-only entities** (e.g. Tripura's TPGL/TPTL,
  Uttarakhand's PTCUL, J&K's JKPCL/JKPTCL) are excluded.
- **Transmission-only entities with confusingly similar names to a
  distribution licensee** are still recorded, but at Tier B with
  `c_and_i_relevance: NONE` and an explicit `overlap_licensee_ids`
  cross-reference — see `DNHDDPCL` vs. `DNHDDPDCL`.
- **Franchisees** are not represented in this registry pass — none were
  identified with confirmed independent-licensee status distinct from a
  parent licensee during this research pass.
- **Predecessor entities** superseded by restructuring/privatization are
  kept as explicit `TIER_C` / `INACTIVE` records linked via
  `predecessor_licensee_ids` / `successor_licensee_ids`, not deleted and not
  left looking active — see `EWEDC` -> `CPDL` (Chandigarh).

## Shared tariff groups

See `packages/india-tariffs/registry/shared_tariff_groups.yaml` and
`schemas/shared_tariff_group.schema.json`. Four groups are currently
modeled:

| Group | Basis | Members |
|---|---|---|
| `GUVNL-DISCOMS` | Common holding company + historically parallel MYT order process | UGVCL, MGVCL, DGVCL, PGVCL |
| `TORRENT-GJ-CIRCLES` | Common corporate group + regulator | TORRENT-AHM, TORRENT-SUR |
| `BSES-DELHI` | Common corporate group + closely-aligned annual order cycle | BRPL, BYPL |
| `JERC-GOA-UT-DEPARTMENTS` | Single UT electricity departments under a shared JERC MYT Regulations framework | AN-ED, LD-ED, PY-ED |

Group membership is an organizational/regulatory-process fact, not a
confirmation that current rates are identical — each member licensee's own
tariff order still needs independent review before its rates are used.

## Unresolved items

See `packages/india-tariffs/registry/licensee_review_queue.yaml` (8 open
items) and the "Known sourcing gaps" section of
[`INDIA_TARIFF_COVERAGE.md`](INDIA_TARIFF_COVERAGE.md).
