# Authoritative Tariff Crawler Architecture

## Document status

- **Status:** Proposed architecture
- **Purpose:** Continuously monitor authoritative Indian electricity-tariff sources and prepare validated tariff updates for controlled publication
- **Related strategy:** [`../data/INDIA_CI_TARIFF_DATA_STRATEGY.md`](../data/INDIA_CI_TARIFF_DATA_STRATEGY.md)

## 1. Objective

Build an automated system that detects and preserves changes published by electricity regulators, distribution licensees and state authorities; converts relevant changes into structured tariff proposals; validates their commercial impact; and submits reviewable GitHub pull requests.

The crawler must accelerate tariff maintenance without allowing an unverified interpretation of a regulatory document to alter BESS calculations.

## 2. Architectural boundary

Automation is divided into two trust zones.

### Automated discovery zone

May perform without tariff approval:

- scheduled source checks;
- link and sitemap discovery;
- document download;
- hashing and immutable storage;
- document classification;
- text, OCR and table extraction;
- candidate rule generation;
- semantic comparison;
- validation and regression execution;
- GitHub issue or pull-request preparation.

### Approved publication zone

May be entered only after policy-defined validation and review:

- acceptance of a material rate or rule change;
- release compilation;
- activation of an effective tariff version;
- production API/database deployment;
- use by the BESS calculator.

The production tariff engine must never depend directly on a regulator website or unreviewed crawler database.

## 3. High-level architecture

```text
Scheduler
   |
   v
Source Registry
   |
   v
Discovery Adapters -----> Source Health Monitor
   |
   v
Safe Fetcher
   |
   +-----> Immutable Object Archive
   |
   v
Document Classifier
   |
   v
Extraction Pipeline
   |
   v
Candidate Normalizer
   |
   v
Semantic Diff Engine
   |
   v
Validation + Golden-Bill Regression
   |
   v
GitHub Change PR
   |
   v
Approval + Release Compiler
   |
   v
Versioned Tariff Dataset
   |
   v
BESS Tariff Engine
```

## 4. Source registry

Crawling behaviour must be configuration driven. A source record identifies the authority, monitored locations, permitted domains, expected content and adapter strategy.

Illustrative source definition:

```yaml
source_id: KERC_TARIFF_ORDERS
jurisdiction_code: KA
authority_code: KERC
authority_type: REGULATOR
source_role: PRIMARY
listing_url: https://kerc.karnataka.gov.in/96/tariff-order/en
allowed_domains:
  - kerc.karnataka.gov.in
discovery_method: HTML_LINKS
adapter: generic_regulator_listing
schedule: DAILY
rate_limit:
  requests_per_minute: 6
patterns:
  include:
    - tariff
    - retail-supply
    - amendment
    - corrigendum
  exclude:
    - petition
    - public-hearing
expected_content:
  minimum_matching_links: 1
  permitted_types:
    - text/html
    - application/pdf
status: ACTIVE
```

Required source fields:

- unique source ID;
- jurisdiction and authority;
- source authority/priority level;
- listing and optional direct-document URLs;
- permitted domains;
- discovery method;
- adapter name and version;
- crawl schedule;
- request rate limit;
- link/document include and exclude patterns;
- expected content type and minimum health expectations;
- last verified date;
- owner and escalation route;
- active, paused, degraded or blocked status.

## 5. Discovery adapters

### 5.1 Generic adapters

The system should first support reusable strategies:

- HTML link listing;
- paginated order listing;
- sitemap discovery;
- RSS/Atom feed;
- JSON/API response;
- predictable direct-document URL;
- official search endpoint;
- browser-rendered page as a controlled fallback.

### 5.2 Custom adapters

A custom adapter is required when a source uses:

- JavaScript-only navigation;
- non-standard pagination;
- nested year/category filters;
- session-dependent download URLs;
- inconsistent document naming;
- multiple pages for orders, amendments and schedules;
- image-only documents;
- a licensee portal separate from the regulator's source.

Adapters should be implemented per authority/source pattern rather than per tariff category.

### 5.3 Safe crawling rules

- Identify the crawler with a documented user agent and contact path.
- Respect published access and crawl policies.
- Apply conservative per-domain rate limits.
- Use conditional HTTP requests with `ETag` and `Last-Modified` where available.
- Use exponential backoff with bounded retries.
- Do not bypass authentication, access controls or anti-bot protections.
- Do not execute downloaded scripts or embedded document content.
- Restrict redirects to configured or explicitly approved domains.
- Validate DNS and destination addresses to prevent server-side request forgery.

## 6. Scheduling

Recommended initial cadence:

| Source | Normal cadence | High-change cadence |
|---|---:|---:|
| SERC/JERC tariff-order page | Daily | Every 6 hours during March–April |
| Tariff-schedule page | Daily | Every 6 hours after a new order |
| DISCOM FAC/FPPAS page | Daily | Daily remains sufficient initially |
| State duty/cess notification page | Weekly | Daily after a detected relevant notice |
| Full source reconciliation | Weekly | Daily for degraded sources |

The scheduler should add jitter so that all official sites are not contacted at exactly the same time.

A daily crawl does not imply daily publication. It only shortens detection time.

## 7. Fetch and immutable preservation

### 7.1 Fetch record

Each retrieval must record:

- requested and final URL;
- source ID;
- retrieval timestamp;
- HTTP status;
- `ETag` and `Last-Modified`;
- content type and length;
- SHA-256 content hash;
- TLS and redirect outcome;
- fetcher version;
- parent/listing page that discovered the document.

### 7.2 Content-addressable storage

Documents should be stored by content hash. The same document published under multiple file names or URLs should be recognized as one binary with multiple observations.

Normal Git history should contain the manifest and approved normalized data. Large PDFs and extracted artifacts should be stored in an immutable object archive or GitHub release asset with the content hash committed to the repository.

### 7.3 Replacement detection

Official sites sometimes replace a PDF without changing its link. The system must distinguish:

- unchanged URL and unchanged hash;
- new URL containing an existing hash;
- unchanged URL with a new hash;
- changed page whose relevant documents are unchanged;
- removed document link;
- inaccessible document.

An unchanged URL with a new hash must produce a high-priority replacement event.

## 8. Document security

All downloaded content is untrusted input even when it comes from an authoritative domain.

Controls should include:

- permitted MIME type and file-extension checks;
- maximum download and decompression limits;
- antivirus/malware scan where infrastructure permits;
- isolated PDF/OCR processing;
- process time and memory limits;
- no macro execution;
- no embedded-link following during parsing;
- escaped extracted text in logs and PR output;
- secret-free workers;
- allowlisted outbound destinations.

Document text must be treated as evidence to extract, never as system instructions.

## 9. Classification

The classifier should distinguish at least:

- final tariff order;
- tariff schedule;
- multi-year tariff order;
- true-up order with no retail-rate change;
- review order;
- amendment;
- corrigendum;
- FAC/FPPAS or equivalent adjustment;
- duty/tax/cess notification;
- supply-code or billing-rule amendment;
- tariff petition or proposal;
- public notice/hearing document;
- irrelevant document.

Only final or legally effective documents may produce publishable tariff candidates. Petitions and proposals may be tracked as early warnings but must never modify approved tariff data.

Classification output should include a confidence score and the evidence used, such as title, order number, issuing authority, signature/order section and effective-date language.

## 10. Extraction pipeline

### 10.1 Extraction order

1. Native PDF/HTML text extraction.
2. Structured table extraction.
3. Layout-aware text reconstruction.
4. OCR for image-only pages.
5. Human-assisted extraction for unresolved documents.

### 10.2 Target information

Extract candidate values and rules for:

- issuing authority and licensee;
- order number and date;
- effective date and validity period;
- consumer category code and description;
- voltage/load/demand applicability;
- billing basis;
- fixed and demand charges;
- energy charges;
- ToD bands and adjustments;
- billing-demand formulas;
- excess demand;
- minimum charge;
- PF/reactive-energy treatment;
- FAC/FPPAS;
- rebates and incentives;
- statutory exclusions;
- superseded orders and corrigenda.

### 10.3 Evidence retention

Each candidate field should retain:

- document ID and content hash;
- page number;
- table/section/paragraph identifier where possible;
- extracted text fragment or table cell coordinates;
- extraction method and version;
- extraction confidence;
- reviewer decision.

Generated values without traceable evidence must fail provenance validation.

## 11. Candidate normalization

Extraction output should not write directly to approved tariff files. It should first create a candidate model.

The normalizer should:

- map original categories to platform taxonomy;
- preserve original names and conditions;
- convert dates to ISO format;
- normalize currency and units;
- preserve decimal precision;
- represent time bands in local time;
- link adjustments to base categories;
- create explicit applicability predicates;
- flag unsupported rule expressions;
- identify possible predecessor/successor records.

Unit conversion must be deterministic and reversible. A value described as paise per unit, rupees per kVAh or percentage of energy charges must not be flattened without retaining its original representation.

## 12. Semantic diff engine

A file hash change does not explain the commercial consequence. The semantic diff should compare approved and candidate tariff models.

It should report:

- new or removed licensees/categories;
- changed effective dates;
- energy-rate changes;
- demand/fixed-charge changes;
- kWh-to-kVAh or kW-to-kVA basis changes;
- applicability-threshold changes;
- ToD window and rate changes;
- billing-demand formula changes;
- FAC/FPPAS observations;
- rebate, PF and load-factor rule changes;
- source/citation changes without commercial change;
- possible retrospective corrections.

Every change should be classified by risk and expected calculator impact.

## 13. Validation and regression

Before creating a publication-ready PR, run:

### 13.1 Structural tests

- schema validity;
- referential integrity;
- allowed units;
- valid effective dates;
- no unintended overlapping active tariffs;
- valid time bands;
- required provenance;
- deterministic category resolution.

### 13.2 Commercial sanity tests

- rates and percentages within configured review bounds;
- no accidental hundredfold paise/rupee conversion;
- demand charge denominator matches billing basis;
- rebates do not exceed the charge they modify unless explicitly permitted;
- adjustment signs are preserved;
- category applicability is not broadened silently;
- effective date is consistent with the order.

Bounds should generate warnings, not replace authoritative values.

### 13.3 Golden-bill tests

For each supported licensee/category family, retain representative inputs and expected bill components. These can come from:

- official bill examples;
- anonymized verified bills;
- an independently reviewed manual calculation.

The engine must reproduce each component within an approved tolerance.

### 13.4 BESS impact regression

Run representative BESS scenarios before and after the candidate change and report:

- base utility bill change;
- demand-charge exposure change;
- ToD arbitrage change;
- grid-charging cost change;
- annual savings change;
- payback/NPV sensitivity where material.

Large impacts should not automatically block an authoritative tariff, but they must require explicit review.

## 14. GitHub change workflow

### 14.1 Generated branch and PR

A detected update should generate a narrow branch such as:

```text
crawler/tariff-update-ka-kerc-2027-03-27
```

The pull request should include:

- source identity and authority;
- order/document title and number;
- publication and effective dates;
- original URL and archived hash;
- affected licensees and categories;
- semantic before/after tariff changes;
- extracted page/table citations;
- validation and golden-bill results;
- BESS regression impact;
- extraction confidence;
- reviewer checklist;
- generated files and compiler version.

### 14.2 Example change summary

```text
Source: KERC tariff order dated 27 March 2027
Effective: 1 April 2027

Affected categories:
- BESCOM HT-2A Industrial
- BESCOM HT-2B Commercial

Semantic changes:
- Energy charge: ₹7.25 → ₹7.48/kVAh
- Demand charge: unchanged
- Peak ToD surcharge: ₹1.00 → ₹1.20/kVAh
- Peak period: unchanged

Reference impact:
- HT industrial archetype bill: +2.8%
- Annual BESS arbitrage value: +6.4%

Extraction confidence: 98%
Evidence: pages 212–218
```

All example values are illustrative.

### 14.3 PR scope

- Prefer one jurisdiction/order family per PR.
- Do not mix an unrelated crawler refactor with tariff data changes.
- A nationwide recurring adjustment batch may be permitted only when the same tested mechanism applies and each source remains independently reviewable.

## 15. Update approval policy

| Change class | Initial policy | Possible mature policy |
|---|---|---|
| Source title/URL/metadata only | Automated validation; normal review | Auto-merge |
| Duplicate document/new filename | Auto-classify and close | Auto-classify and close |
| Recurring FAC/FPPAS numeric update | Human review | Auto-merge for a proven deterministic adapter with all tests passing |
| Base energy or demand charge | Human tariff review | Human tariff review |
| Billing-demand or applicability rule | Human tariff and engine review | Human tariff and engine review |
| ToD period or adjustment method | Human tariff and BESS-impact review | Human tariff and BESS-impact review |
| Corrigendum/review order | Human review and retrospective test | Human review and retrospective test |
| Low-confidence extraction | Block | Block |

A source adapter may graduate to greater automation only after several correctly reviewed cycles and documented precision/recall evidence.

## 16. Source and adapter health

The monitoring system must detect failures that ordinary HTTP success checks miss.

Alert conditions include:

- source unavailable;
- redirects to an unexpected domain;
- authentication/anti-bot response;
- page layout change;
- expected links disappear;
- link count changes beyond configured limits;
- parser returns no categories from a known tariff schedule;
- published document lacks a reliable effective date;
- OCR quality falls below threshold;
- source document is replaced in place;
- crawl has not succeeded within the freshness objective;
- an approved tariff is near expiry with no successor discovered.

A successful request returning zero tariff documents must not be treated as proof that nothing changed.

## 17. Observability

Track at least:

- last successful crawl per source;
- last document change;
- source and adapter health;
- documents discovered, fetched, deduplicated and rejected;
- extraction success rate;
- classification confidence;
- candidate records produced;
- validation failures;
- PRs opened, approved, rejected and corrected;
- time from official publication to detection;
- time from detection to review-ready PR;
- time from approval to release;
- stale active tariffs and unresolved coverage gaps.

Recommended initial service objectives:

- active sources checked within 24 hours;
- new public documents detected within 48 hours under normal conditions;
- high-priority source replacement alerts within one crawl cycle;
- no approved release without passing provenance and schema checks;
- complete reproduction of the dataset version used in every BESS result.

## 18. Deployment progression

### Stage 1 — Repository pilot

Use scheduled GitHub Actions for a small number of sources.

Suitable for:

- source-registry validation;
- generic HTML/PDF discovery;
- manifest and hash generation;
- extraction fixtures;
- proof of semantic PR generation.

Limitations:

- weak persistent crawl state;
- variable network conditions;
- workflow-time limits;
- awkward storage for growing PDF archives;
- limited operational controls.

### Stage 2 — Persistent crawler service

Run a scheduled container with:

- PostgreSQL crawl state;
- object storage for immutable source documents;
- a work queue;
- isolated extraction workers;
- retry and dead-letter handling;
- GitHub App integration for issues/PRs;
- monitoring and alerting.

GitHub remains the review and audit interface even when crawling moves outside GitHub Actions.

### Stage 3 — Production tariff data service

Add:

- release compiler and signed manifests;
- tariff query and bill-calculation APIs;
- historical data warehouse/Parquet exports;
- refresh dashboards;
- consumer notifications for approved tariff changes;
- rollback to prior dataset release.

## 19. Testing strategy

### Unit tests

- URL normalization and allowlisting;
- hash/deduplication logic;
- link filters;
- date and currency parsing;
- unit normalization;
- table-cell extraction;
- time-band parsing;
- semantic diff classification.

### Fixture replay

Every adapter should have captured, non-sensitive HTML/PDF fixtures so parser changes can be tested without repeatedly contacting public websites.

### Contract tests

Run lightweight scheduled checks against live sources to detect source-layout changes. Contract checks should not download the full history on every run.

### Failure tests

Include:

- corrupt PDF;
- image-only PDF;
- wrong MIME type;
- in-place file replacement;
- circular redirects;
- unexpected domain redirect;
- oversized file;
- missing effective date;
- conflicting order and schedule values;
- overlapping tariff versions;
- paise/rupee unit confusion;
- category renamed without an obvious predecessor.

### End-to-end tests

A complete test should demonstrate:

```text
new official document
→ archive and hash
→ classify
→ extract candidate
→ normalize
→ semantic diff
→ validate
→ regression report
→ generated GitHub PR payload
→ approved release artifact
→ tariff-engine resolution
```

## 20. Security and governance responsibilities

| Responsibility | Owner |
|---|---|
| Source registry and authority verification | Tariff-data owner |
| Fetcher security and adapter maintenance | Platform/data engineering |
| Tariff interpretation | Regulatory/tariff reviewer |
| Billing-rule implementation | Tariff-engine owner |
| Golden-bill validation | Tariff reviewer and QA |
| BESS impact review | BESS modelling owner |
| Release approval | Designated data steward |
| Production activation and rollback | Platform operations |

No single automated model or extraction worker should have authority to discover, interpret, approve and publish a material tariff change.

## 21. Initial implementation backlog

1. Define source-registry JSON Schema.
2. Populate all jurisdictions, regulators and initial licensees.
3. Implement generic HTML-link and PDF fetch adapters.
4. Add content hashing, deduplication and immutable manifest.
5. Implement document classification states.
6. Add native PDF text extraction and OCR fallback interface.
7. Define candidate tariff and provenance schemas.
8. Build semantic diff output.
9. Create GitHub tariff-update PR template.
10. Build golden-bill fixture framework.
11. Pilot Maharashtra, Gujarat and Karnataka sources.
12. Establish source-health and freshness reporting.
13. Review pilot precision before expanding coverage.
14. Move persistent state and documents to PostgreSQL/object storage when scale requires it.

## 22. Acceptance criteria

The crawler foundation is acceptable when:

- all network access is limited to registered authoritative domains;
- unchanged content produces no tariff change;
- in-place document replacement is detected;
- every downloaded document is hashed and preserved;
- proposals retain page/table evidence;
- petitions cannot be mistaken for effective orders;
- schema and commercial validation run before a PR is publication-ready;
- generated PRs show semantic and BESS impact, not merely file diffs;
- low-confidence or conflicting extraction is blocked;
- source failures are visible;
- approved and unapproved data are technically separated;
- production calculations use an immutable tariff release version;
- a historical BESS result can be reproduced using its pinned tariff dataset.
