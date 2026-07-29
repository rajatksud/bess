# India C&I Electricity Tariff Data Strategy

## Document status

- **Status:** Proposed foundation
- **Scope:** India-wide HT/LT industrial and commercial retail electricity tariffs
- **Primary consumer:** BESS tariff, dispatch and financial engines
- **Initial release baseline:** Tariffs effective on or before 29 July 2026
- **Related documents:**
  - [`../BESS_ROI_Calculator_Coding_Specification.md`](../BESS_ROI_Calculator_Coding_Specification.md)
  - [`../architecture/BESS_SYSTEM_ARCHITECTURE.md`](../architecture/BESS_SYSTEM_ARCHITECTURE.md)
  - [`../architecture/AUTHORITATIVE_TARIFF_CRAWLER_ARCHITECTURE.md`](../architecture/AUTHORITATIVE_TARIFF_CRAWLER_ARCHITECTURE.md)
  - [`../product/BESS_PLATFORM_PRODUCT_STRATEGY.md`](../product/BESS_PLATFORM_PRODUCT_STRATEGY.md)

## 1. Purpose

Establish a trustworthy, maintainable and machine-readable foundation for understanding HT/LT industrial and commercial electricity tariffs across India.

This data is required for the BESS platform to calculate, among other things:

- demand-charge reduction and peak-shaving value;
- time-of-day energy arbitrage;
- grid-charging cost;
- solar self-consumption value;
- the opportunity cost of export, banking or settlement;
- changes in utility bills before and after BESS dispatch;
- multi-year tariff escalation and sensitivity;
- comparable BESS attractiveness across locations and consumer profiles.

The tariff programme must be treated as a versioned regulatory data product. Tariff values must not be embedded in UI components, calculation formulas or unversioned spreadsheets.

## 2. Core decisions

1. **Tariff data and tariff calculation logic are separate domains.**
   - `india-tariffs` owns sources, provenance and normalized tariff records.
   - `tariff-engine` owns category resolution, billing rules and bill calculation.

2. **The workstream is independently governed but initially remains inside the BESS repository.**
   - This allows data and calculation contracts to evolve together.
   - The package can later be extracted into a dedicated repository if it becomes a shared platform asset.

3. **Authoritative websites will be monitored automatically.**
   - Discovery, downloading, classification, extraction and comparison should be automated.
   - Material tariff changes must pass validation before publication.

4. **State alone is not a tariff key.**
   A tariff is resolved through a hierarchy such as:

   ```text
   Jurisdiction
   → Regulator
   → Distribution licensee
   → Consumer category
   → Voltage and demand applicability
   → Effective date
   → Billing and time-period rules
   ```

5. **Every material value and rule requires field-level provenance.**
   The data must retain the source order, URL, document hash, page/table reference, effective date, extraction method and review status.

6. **The BESS calculator consumes only approved, versioned releases.**
   Raw or newly crawled data must never reach production calculations directly.

7. **No single headline tariff will be used for state comparisons.**
   Cross-state analysis will use standard customer archetypes and executable bill calculations.

## 3. Coverage

### 3.1 Geographic coverage

The source registry should cover:

- all 28 states;
- all 8 Union Territories;
- State Electricity Regulatory Commissions (SERCs);
- Joint Electricity Regulatory Commissions (JERCs);
- relevant state government departments for duties and cesses;
- every distribution licensee serving in-scope consumers.

Union Territories are included even though the core request is state tariffs because important C&I markets such as Delhi, Chandigarh, Jammu and Kashmir, and Puducherry would otherwise be omitted.

### 3.2 Consumer coverage

Initial scope:

- LT industrial;
- LT commercial/non-domestic;
- HT industrial;
- HT commercial/non-domestic;
- EHT industrial or commercial categories where they are part of the same retail tariff schedule;
- permanent grid-connected retail supply;
- special variants that can materially affect BESS economics, such as night tariffs or time-of-day categories.

### 3.3 Charges and rules in scope

The first complete release should represent:

- fixed/customer charges;
- demand charges;
- energy charges;
- kWh or kVAh billing basis;
- time-of-day/time-of-use additions and rebates;
- seasonal time bands;
- billing-demand definitions;
- minimum billing demand;
- contract-demand ratchets;
- excess-demand charges;
- minimum charges;
- power-factor penalties and incentives;
- load-factor incentives;
- voltage rebates;
- reactive-energy charges;
- FAC/FPPAS/PPA or equivalent variable adjustments;
- electricity duty, tax and cess where an authoritative source is available;
- prompt-payment rebates and delayed-payment surcharges where material to bill reconstruction;
- effective dates, supersession and corrigenda.

### 3.4 Deferred extensions

The following should use compatible schemas but may be implemented after the retail-tariff foundation:

- open-access wheeling and transmission charges;
- cross-subsidy and additional surcharges;
- captive and group-captive treatment;
- banking charges and losses;
- net metering, net billing and gross metering;
- export settlement and avoided-cost rates;
- renewable-energy and green-open-access products;
- special economic zone and deemed-licensee arrangements;
- temporary supply;
- regulatory demand-response and ancillary-service revenue.

These extensions are important to advanced BESS analysis but should not delay a defensible retail-tariff dataset.

## 4. Authoritative source hierarchy

Sources should be prioritized as follows:

1. Commission tariff order, review order or corrigendum.
2. Commission-approved tariff schedule.
3. State Gazette or state government duty/tax notification.
4. Official distribution-licensee circular implementing an approved charge.
5. Official bill calculator or bill format, used for validation rather than primary rule authority.
6. Secondary summaries, used for discovery only and never as the source of record.

Initial source discovery can begin with the Forum of Regulators directory:

- <https://forumofregulators.gov.in/important-websites.html>

Examples demonstrating why the source model must support multiple licensees and effective dates include:

- Gujarat tariff schedules: <https://gercin.org/tariff-schedules/>
- Karnataka tariff orders: <https://kerc.karnataka.gov.in/96/tariff-order/en>
- Delhi tariff orders: <https://www.derc.gov.in/tarriff-orders>
- Maharashtra/MSEDCL consumer and tariff publications: <https://www.mahadiscom.in/consumer/en/tariff-details/>

The registry must not assume that each authority uses stable URLs, consistent file names, searchable PDFs or a single annual order.

## 5. Domain model

### 5.1 Core entities

| Entity | Purpose |
|---|---|
| `Jurisdiction` | State or Union Territory identity |
| `Regulator` | SERC/JERC responsible for tariff approval |
| `Licensee` | Distribution licensee and service territory |
| `AuthoritativeSource` | Monitored listing page, API, feed or document source |
| `SourceDocument` | Immutable retrieved order, schedule, circular or notification |
| `TariffOrder` | Regulatory order identity, dates and legal status |
| `TariffCategory` | Consumer category and applicability conditions |
| `ChargeComponent` | Fixed, demand, energy, ToD, surcharge, duty or incentive rule |
| `TimeBand` | Time, day, season and holiday applicability |
| `BillingDemandRule` | Formula used to determine billed demand |
| `AdjustmentSeries` | FAC/FPPAS or other periodically changing charge |
| `SourceCitation` | Page/table/paragraph provenance for a field or rule |
| `TariffRelease` | Approved, immutable dataset version |

### 5.2 Category identity

The normalized taxonomy must preserve the regulator's original category code and wording while mapping it to a platform-level classification.

Example classification dimensions:

- `consumer_class`: `INDUSTRIAL`, `COMMERCIAL`, `MIXED`, `OTHER`;
- `supply_level`: `LT`, `HT`, `EHT`;
- `billing_energy_basis`: `KWH`, `KVAH`;
- `billing_demand_basis`: `KW`, `KVA`, `HP`, `NONE`;
- minimum/maximum sanctioned load;
- minimum/maximum contract demand;
- voltage range;
- activity or industry restrictions;
- optional meter or smart-meter requirement;
- location or service-territory condition;
- optional selection/opt-in condition.

Original category text must remain available because normalized labels cannot safely capture every legal qualification.

### 5.3 Charge components

A charge should be represented as a typed rule, not a free-text amount.

Required fields include:

- charge type;
- value and currency;
- unit and denominator;
- additive, multiplicative or rebate behaviour;
- applicability predicate;
- applicable time band;
- minimum/maximum limits;
- taxability where known;
- effective interval;
- source citation;
- verification status.

Use decimal strings and explicit units. Do not use binary floating-point values as the source of truth for money.

Example units include:

- `INR_PER_CONNECTION_MONTH`;
- `INR_PER_KW_MONTH`;
- `INR_PER_KVA_MONTH`;
- `INR_PER_KWH`;
- `INR_PER_KVAH`;
- `PERCENT_OF_ENERGY_CHARGE`;
- `PERCENT_OF_BILL`.

### 5.4 Billing-demand rules

Billing-demand rules materially affect peak-shaving value and must be machine executable.

The tariff engine should initially support enumerated strategies such as:

- actual recorded demand;
- maximum of recorded demand and a percentage of contract demand;
- maximum of recorded demand and a percentage of historical demand;
- fixed contract demand;
- excess-demand multiplier above contract demand;
- separate normal and excess demand charges.

Complex rules that are not yet executable may be stored as reviewed source text, but the tariff must be marked as partially supported and should not receive a high confidence grade.

### 5.5 Time-band rules

Time bands must support:

- local time zone;
- start and end times, including intervals crossing midnight;
- weekday/weekend distinctions;
- holidays where explicitly defined;
- seasonal date ranges;
- additive surcharge;
- additive rebate;
- rate replacement;
- multiplicative adjustment;
- smart-meter applicability;
- overlapping-band validation.

### 5.6 Variable adjustments

FAC/FPPAS and similar adjustments should not be overwritten into a base tariff record. Store them as separate effective-dated observations linked to the applicable categories and order.

This supports:

- accurate historical bill reconstruction;
- volatility analysis;
- future scenario assumptions;
- correction or replacement without mutating the base order;
- distinguishing published base tariff from realised effective tariff.

## 6. Illustrative canonical record

The following values are illustrative and are not approved tariff facts.

```yaml
tariff_id: IN-KA-BESCOM-HT2A-2026-04-01
schema_version: 1.0.0
jurisdiction_code: KA
regulator_code: KERC
licensee_code: BESCOM
category_code: HT-2A
category_name: HT Industrial
consumer_class: INDUSTRIAL
supply_level: HT
effective_from: 2026-04-01
effective_to: null

applicability:
  voltage_min_kv: "11"
  contract_demand_min_kva: "100"

billing:
  energy_basis: KVAH
  demand_basis: KVA
  demand_window_minutes: 15
  billing_demand_rule:
    strategy: MAX_RECORDED_OR_PERCENT_CONTRACT
    minimum_contract_demand_pct: "85"

charges:
  - charge_id: DEMAND_STANDARD
    type: DEMAND
    value: "350.00"
    currency: INR
    unit: INR_PER_KVA_MONTH
    source_citation_id: citation-1
  - charge_id: ENERGY_STANDARD
    type: ENERGY
    value: "7.25"
    currency: INR
    unit: INR_PER_KVAH
    source_citation_id: citation-2

source_citations:
  - citation_id: citation-1
    document_id: KERC-ORDER-EXAMPLE
    page: 214
    table: HT-2A
    verification_status: REVIEWED
  - citation_id: citation-2
    document_id: KERC-ORDER-EXAMPLE
    page: 214
    table: HT-2A
    verification_status: REVIEWED
```

## 7. Repository and package structure

```text
packages/
├── india-tariffs/
│   ├── README.md
│   ├── registry/
│   │   ├── jurisdictions.yaml
│   │   ├── regulators.yaml
│   │   ├── licensees.yaml
│   │   └── sources.yaml
│   ├── schemas/
│   ├── data/
│   │   ├── normalized/
│   │   └── reference/
│   ├── coverage/
│   ├── crawler/
│   ├── compiler/
│   └── tests/
└── tariff-engine/
    ├── src/
    └── tests/
```

The human-reviewed source of truth may use YAML for readability, provided it is schema validated. Release compilation should generate:

- canonical JSON for runtime and APIs;
- Parquet for analysis;
- CSV coverage and source manifests;
- checksums;
- validation and regression reports.

Large source PDFs should not accumulate in normal Git history. Preserve them in immutable object storage or release assets and commit their URLs, hashes and retrieval metadata.

## 8. Data collection and approval lifecycle

A tariff record moves through explicit states:

```text
DISCOVERED
→ ARCHIVED
→ CLASSIFIED
→ EXTRACTED
→ VALIDATED
→ REVIEW_READY
→ APPROVED
→ PUBLISHED
→ EFFECTIVE
→ SUPERSEDED
```

### 8.1 Discovery and acquisition

- Monitor configured authoritative sources.
- Detect new documents, changed files and new effective-dated notices.
- Preserve the original document before extraction.
- Record URL, retrieval time, content type, size, hash and HTTP metadata.

### 8.2 Extraction

- Extract native PDF text and tables where possible.
- Use OCR only when necessary.
- Classify tariff tables, general conditions, billing rules and effective dates.
- Retain page coordinates or page/table references where supported.
- Generate proposed normalized records without publishing them.

### 8.3 Review

A reviewer must verify:

- source authority;
- order status and effective date;
- licensee and category applicability;
- kWh/kVAh and kW/kVA units;
- demand and minimum-bill rules;
- time bands and seasonal rules;
- amendment/corrigendum effects;
- duties and variable adjustments;
- before/after bill impact.

### 8.4 Publication

Approved changes are compiled into a versioned release. The release manifest must include:

- dataset version;
- schema version;
- publication timestamp;
- source-document checksums;
- jurisdictions and licensees covered;
- validation results;
- unresolved warnings;
- superseded release, where applicable.

## 9. Quality assurance

### 9.1 Validation layers

1. **Schema validation** — required fields, enums, types and units.
2. **Referential validation** — valid regulator, licensee, category and source IDs.
3. **Temporal validation** — no unexplained overlaps or effective-date gaps.
4. **Commercial validation** — non-negative rates, correct denominators and charge behaviour.
5. **Time-band validation** — no invalid or unintended gaps/overlaps.
6. **Provenance validation** — every material field has a source citation.
7. **Golden-bill validation** — reproduce official or independently verified bills.
8. **Regression validation** — measure bill and BESS-result change before publication.

### 9.2 Confidence grades

| Grade | Meaning |
|---|---|
| A | Authoritative source, executable rules, field citations and verified bill reproduction |
| B | Authoritative source and reviewed extraction; limited bill evidence |
| C | Authoritative source but some rules remain text-only or uncertain |
| D | Provisional discovery/extraction; not approved for production |
| X | Stale, conflicting or blocked source; calculation must not proceed silently |

The BESS calculator may use only approved records and must surface the confidence grade.

## 10. BESS consumption contract

The BESS platform must not scrape source websites during a calculation. It should consume an approved release pinned by version and checksum.

Example lock record:

```json
{
  "dataset": "india-tariffs",
  "version": "2026.07.0",
  "schemaVersion": "1.0.0",
  "sha256": "...",
  "effectiveAsOf": "2026-07-29"
}
```

A tariff resolver should use, at minimum:

- billing date;
- jurisdiction;
- licensee/service territory;
- industrial or commercial use;
- LT/HT/EHT supply level;
- supply voltage;
- sanctioned load;
- contract demand;
- billing energy and demand basis;
- optional smart-meter/ToD eligibility;
- optional customer-selected tariff variant.

If more than one category matches, the resolver must return an ambiguity error rather than silently selecting one.

Every BESS result should retain:

- tariff dataset and schema versions;
- resolved tariff and category IDs;
- tariff order and effective date;
- source citations or an audit link;
- adjustment period used;
- rule IDs executed;
- excluded or estimated charges;
- calculation warnings;
- tariff confidence grade.

## 11. Tariff APIs

Indicative contracts:

```http
GET /api/v1/tariffs/coverage
GET /api/v1/tariffs/releases
GET /api/v1/tariffs/{tariffId}
POST /api/v1/tariffs/resolve
POST /api/v1/tariffs/calculate-bill
POST /api/v1/tariffs/compare-bills
```

The bill API should accept interval data where ToD and demand calculations require it. Monthly aggregate data may be supported with an explicit lower-confidence result.

## 12. Cross-state analysis

A direct comparison of headline energy rates is misleading. State and licensee comparisons should use standard archetypes.

Initial archetypes should include:

- LT commercial;
- LT industrial;
- HT commercial;
- HT industrial;
- high-load-factor continuous industry;
- daytime solar-equipped industry;
- low-power-factor consumer;
- consumer with a sharp 15-minute peak.

Each archetype defines:

- sanctioned load and contract demand;
- voltage;
- monthly consumption;
- interval load shape;
- load factor;
- power factor;
- weekday/weekend operation;
- seasonal profile;
- optional solar profile.

Analysis outputs should include:

- effective total cost per kWh or kVAh;
- fixed and demand charges as a percentage of the bill;
- marginal off-peak, normal and peak energy cost;
- ToD spread;
- charging-window duration;
- demand-ratchet exposure;
- power-factor sensitivity;
- variable-adjustment volatility;
- achievable peak-shaving value;
- theoretical and simulated arbitrage value;
- effect of BESS round-trip losses;
- source freshness and confidence.

These outputs can later support a transparent BESS tariff-opportunity score, but the underlying measures must remain visible.

## 13. Rollout

### Wave 0 — Foundation

- approve taxonomy and schema;
- create full jurisdiction/regulator/licensee registry;
- create source-registry format;
- implement provenance and effective-date rules;
- define representative bill archetypes;
- establish dataset versioning.

### Wave 1 — Schema stress test

Initial jurisdictions:

- Maharashtra;
- Gujarat;
- Karnataka;
- Tamil Nadu;
- Telangana;
- Delhi.

These jurisdictions provide useful variation in multiple licensees, kVAh billing, tariff categories, time bands, adjustments and source formats.

### Wave 2 — Major industrial coverage

Expand to other major industrial and commercial markets while repairing schema gaps discovered in Wave 1.

### Wave 3 — Complete India coverage

Complete all states and Union Territories, verify coverage gaps and publish the first India-wide release.

### Wave 4 — Advanced regulatory economics

Add open access, captive, banking, net/gross billing and export-settlement modules.

## 14. GitHub operating model

Recommended labels:

- `tariff-data`;
- `tariff-crawler`;
- `jurisdiction:<code>`;
- `source-change`;
- `extraction-review`;
- `billing-regression`;
- `confidence:A|B|C|D|X`;
- `release-blocker`.

Recommended issue hierarchy:

1. India C&I Tariff Dataset v1 epic.
2. Schema and taxonomy issue.
3. Source registry and crawler framework issue.
4. One coverage issue per jurisdiction.
5. One issue per custom source adapter.
6. Golden-bill and regression framework issue.
7. Initial dataset release issue.
8. BESS tariff-engine integration issue.

Crawler-generated changes should arrive as narrow pull requests with semantic change summaries and source evidence. Structural tariff changes should not be mixed across unrelated jurisdictions in one PR.

## 15. Risks and controls

| Risk | Control |
|---|---|
| Multiple licensees use different schedules | Licensee and service territory are mandatory resolution dimensions |
| Orders are amended or corrected | Effective dating, supersession and corrigendum relationships |
| A PDF is silently replaced | Immutable snapshot and content hash |
| PDF extraction changes a unit | Explicit unit schema, citation and bill regression |
| FAC/FPPAS is treated as base tariff | Separate adjustment series |
| Category resolver selects incorrectly | Deterministic predicates and ambiguity errors |
| Website layout changes | Source health checks and adapter failure alerts |
| Unreviewed crawler output reaches production | Approved-release boundary |
| Historical calculations change after an update | Pinned dataset version and checksum |
| Cross-state ranking becomes misleading | Standard customer archetypes and component-level reporting |

## 16. Definition of done for the first production release

The first production tariff release is complete when:

- every state and Union Territory has a documented coverage status;
- every in-scope licensee has a monitored authoritative source or a recorded blocker;
- every published tariff value has provenance;
- category and effective-date resolution is deterministic;
- supported billing-demand and time-band rules are executable;
- a representative bill regression exists for each supported licensee/category family;
- unresolved rules are surfaced and confidence graded;
- the dataset is compiled into immutable JSON and analysis artifacts;
- the BESS calculator can pin and report the dataset version;
- no production calculation can consume unapproved crawler output.

## 17. Immediate next steps

1. Approve this strategy and the crawler architecture.
2. Create the `packages/india-tariffs` scaffold.
3. Define JSON Schema for registry, tariff, charge, time-band and provenance records.
4. Build the jurisdiction, regulator and licensee registries.
5. Implement the generic crawler and immutable source manifest.
6. Pilot Maharashtra, Gujarat and Karnataka adapters.
7. Establish golden-bill fixtures before scaling extraction.
8. Publish the first reviewed pilot dataset release.
