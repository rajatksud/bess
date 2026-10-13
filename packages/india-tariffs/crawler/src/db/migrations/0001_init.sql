-- India tariff crawler: initial schema.
-- Additive only. See docs/architecture/AUTHORITATIVE_TARIFF_CRAWLER_ARCHITECTURE.md
-- and docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md for the domain model this
-- implements. All tables live in the schema named by CRAWLER_DATABASE_SCHEMA
-- (the migration runner sets search_path before executing this file).

-- Reference/registry entities -------------------------------------------------

CREATE TABLE jurisdictions (
    code                TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    jurisdiction_type   TEXT NOT NULL CHECK (jurisdiction_type IN ('STATE', 'UNION_TERRITORY')),
    coverage_status     TEXT NOT NULL CHECK (coverage_status IN ('NOT_STARTED', 'IN_PROGRESS', 'COVERED', 'BLOCKED')),
    last_verified_at    DATE,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE regulators (
    code                TEXT PRIMARY KEY,
    legal_name          TEXT NOT NULL,
    short_name          TEXT,
    regulator_type      TEXT NOT NULL CHECK (regulator_type IN ('SERC', 'JERC')),
    website             TEXT,
    order_portal_url    TEXT,
    active              BOOLEAN NOT NULL DEFAULT true,
    last_verified_at    DATE,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE regulator_jurisdictions (
    regulator_code      TEXT NOT NULL REFERENCES regulators(code) ON DELETE CASCADE,
    jurisdiction_code   TEXT NOT NULL REFERENCES jurisdictions(code) ON DELETE CASCADE,
    PRIMARY KEY (regulator_code, jurisdiction_code)
);

CREATE TABLE licensees (
    code                    TEXT PRIMARY KEY,
    legal_name              TEXT NOT NULL,
    common_name             TEXT,
    jurisdiction_code       TEXT NOT NULL REFERENCES jurisdictions(code),
    regulator_code          TEXT NOT NULL REFERENCES regulators(code),
    licensee_type           TEXT NOT NULL CHECK (licensee_type IN
                                ('STATE_UTILITY', 'PRIVATE_DISCOM', 'MUNICIPAL', 'DEEMED_LICENSEE', 'SPECIAL_AREA', 'OTHER')),
    service_territory       TEXT,
    website                 TEXT,
    status                  TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN ('ACTIVE', 'INACTIVE', 'UNKNOWN')),
    shares_schedule_with    TEXT REFERENCES licensees(code),
    coverage_status         TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (coverage_status IN
                                ('NOT_STARTED', 'IN_PROGRESS', 'COVERED', 'BLOCKED')),
    last_verified_at        DATE,
    evidence_url            TEXT,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_licensees_jurisdiction ON licensees(jurisdiction_code);
CREATE INDEX idx_licensees_regulator ON licensees(regulator_code);

CREATE TABLE authoritative_sources (
    source_id               TEXT PRIMARY KEY,
    jurisdiction_code       TEXT REFERENCES jurisdictions(code),
    regulator_code          TEXT REFERENCES regulators(code),
    licensee_code           TEXT REFERENCES licensees(code),
    url                     TEXT NOT NULL,
    allowed_domains         TEXT[] NOT NULL,
    source_type             TEXT NOT NULL CHECK (source_type IN
                                ('TARIFF_ORDER', 'TARIFF_SCHEDULE', 'GAZETTE_NOTIFICATION',
                                 'LICENSEE_CIRCULAR', 'BILL_CALCULATOR', 'SECONDARY_SUMMARY')),
    authority_rank          SMALLINT NOT NULL,
    discovery_method        TEXT NOT NULL CHECK (discovery_method IN
                                ('HTML_LINKS', 'PAGINATED_LISTING', 'SITEMAP', 'RSS_ATOM',
                                 'JSON_API', 'DIRECT_DOCUMENT', 'SEARCH_ENDPOINT', 'BROWSER_RENDERED')),
    adapter                 TEXT NOT NULL,
    schedule                TEXT NOT NULL DEFAULT 'DAILY' CHECK (schedule IN
                                ('HOURLY', 'EVERY_6_HOURS', 'DAILY', 'WEEKLY')),
    rate_limit_per_minute   SMALLINT NOT NULL DEFAULT 6,
    include_patterns        TEXT[] NOT NULL DEFAULT '{}',
    exclude_patterns        TEXT[] NOT NULL DEFAULT '{}',
    permitted_content_types TEXT[] NOT NULL DEFAULT '{"text/html","application/pdf"}',
    owner                   TEXT,
    monitoring_status       TEXT NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (monitoring_status IN
                                ('ACTIVE', 'PAUSED', 'DEGRADED', 'BLOCKED', 'NOT_CONFIGURED')),
    last_verified_at        DATE,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (regulator_code IS NOT NULL OR licensee_code IS NOT NULL OR source_type = 'SECONDARY_SUMMARY')
);

CREATE INDEX idx_sources_jurisdiction ON authoritative_sources(jurisdiction_code);
CREATE INDEX idx_sources_status ON authoritative_sources(monitoring_status);

-- Scheduling / operational state ----------------------------------------------

CREATE TABLE crawl_schedules (
    source_id           TEXT PRIMARY KEY REFERENCES authoritative_sources(source_id) ON DELETE CASCADE,
    cadence             TEXT NOT NULL CHECK (cadence IN ('HOURLY', 'EVERY_6_HOURS', 'DAILY', 'WEEKLY')),
    next_run_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_run_at         TIMESTAMPTZ,
    last_success_at     TIMESTAMPTZ,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crawl_runs (
    id                  BIGSERIAL PRIMARY KEY,
    source_id           TEXT NOT NULL REFERENCES authoritative_sources(source_id),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL')),
    links_discovered    INTEGER NOT NULL DEFAULT 0,
    documents_fetched   INTEGER NOT NULL DEFAULT 0,
    new_documents       INTEGER NOT NULL DEFAULT 0,
    replacements_detected INTEGER NOT NULL DEFAULT 0,
    error_summary       TEXT,
    crawler_version     TEXT NOT NULL
);

CREATE INDEX idx_crawl_runs_source ON crawl_runs(source_id, started_at DESC);

CREATE TABLE fetch_observations (
    id                  BIGSERIAL PRIMARY KEY,
    crawl_run_id        BIGINT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
    source_id           TEXT NOT NULL REFERENCES authoritative_sources(source_id),
    requested_url       TEXT NOT NULL,
    final_url           TEXT NOT NULL,
    parent_listing_url  TEXT,
    retrieved_at        TIMESTAMPTZ NOT NULL,
    http_status         INTEGER NOT NULL,
    content_type        TEXT,
    content_length      BIGINT,
    sha256              TEXT NOT NULL,
    fetcher_version     TEXT NOT NULL
);

CREATE INDEX idx_fetch_obs_run ON fetch_observations(crawl_run_id);
CREATE INDEX idx_fetch_obs_sha256 ON fetch_observations(sha256);

-- Immutable document identity ---------------------------------------------------

CREATE TABLE source_documents (
    document_id         TEXT PRIMARY KEY,
    source_id           TEXT NOT NULL REFERENCES authoritative_sources(source_id),
    sha256              TEXT NOT NULL UNIQUE,
    storage_uri         TEXT NOT NULL,
    content_type        TEXT,
    size_bytes          BIGINT,
    document_type       TEXT NOT NULL,
    first_seen_at       TIMESTAMPTZ NOT NULL,
    last_observed_at    TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_url_aliases (
    id                  BIGSERIAL PRIMARY KEY,
    document_id         TEXT NOT NULL REFERENCES source_documents(document_id) ON DELETE CASCADE,
    url                 TEXT NOT NULL,
    first_observed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, url)
);

CREATE INDEX idx_url_aliases_url ON document_url_aliases(url);

-- Classification / extraction pipeline -------------------------------------------

CREATE TABLE classification_results (
    id                  BIGSERIAL PRIMARY KEY,
    document_id         TEXT NOT NULL REFERENCES source_documents(document_id) ON DELETE CASCADE,
    document_class      TEXT NOT NULL CHECK (document_class IN
                            ('FINAL_TARIFF_ORDER', 'TARIFF_SCHEDULE', 'MYT_ORDER', 'REVIEW_ORDER',
                             'TRUE_UP_NO_RATE_CHANGE', 'TRUE_UP_WITH_RATE_CHANGE', 'AMENDMENT',
                             'CORRIGENDUM', 'FAC_FPPAS_ADJUSTMENT', 'DUTY_TAX_CESS_NOTIFICATION',
                             'SUPPLY_CODE_AMENDMENT', 'TARIFF_PETITION', 'PUBLIC_NOTICE', 'IRRELEVANT')),
    confidence          NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    evidence            JSONB NOT NULL DEFAULT '{}',
    classifier_version  TEXT NOT NULL,
    classified_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_classification_document ON classification_results(document_id);

CREATE TABLE extraction_jobs (
    id                  BIGSERIAL PRIMARY KEY,
    document_id         TEXT NOT NULL REFERENCES source_documents(document_id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
                            ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    method              TEXT NOT NULL CHECK (method IN ('NATIVE_TEXT', 'TABLE_EXTRACTION', 'OCR', 'MANUAL')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE extraction_attempts (
    id                  BIGSERIAL PRIMARY KEY,
    extraction_job_id   BIGINT NOT NULL REFERENCES extraction_jobs(id) ON DELETE CASCADE,
    attempt_number      INTEGER NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    extractor_version   TEXT NOT NULL,
    error_message       TEXT,
    UNIQUE (extraction_job_id, attempt_number)
);

-- Candidate tariff data (never auto-promoted to approved) ------------------------

CREATE TABLE candidate_tariffs (
    id                      BIGSERIAL PRIMARY KEY,
    extraction_attempt_id   BIGINT NOT NULL REFERENCES extraction_attempts(id),
    document_id             TEXT NOT NULL REFERENCES source_documents(document_id),
    jurisdiction_code       TEXT NOT NULL REFERENCES jurisdictions(code),
    licensee_code           TEXT REFERENCES licensees(code),
    category_code           TEXT NOT NULL,
    category_name_original  TEXT NOT NULL,
    consumer_class          TEXT CHECK (consumer_class IN ('INDUSTRIAL', 'COMMERCIAL', 'MIXED', 'OTHER')),
    supply_level            TEXT CHECK (supply_level IN ('LT', 'HT', 'EHT')),
    billing_energy_basis    TEXT CHECK (billing_energy_basis IN ('KWH', 'KVAH')),
    billing_demand_basis    TEXT CHECK (billing_demand_basis IN ('KW', 'KVA', 'HP', 'NONE')),
    order_number            TEXT,
    order_date              DATE,
    publication_date        DATE,
    effective_from          DATE,
    effective_to             DATE,
    retrieved_at             TIMESTAMPTZ NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'EXTRACTED' CHECK (status IN
                                ('DISCOVERED', 'ARCHIVED', 'CLASSIFIED', 'EXTRACTED', 'VALIDATED',
                                 'REVIEW_READY', 'APPROVED', 'PUBLISHED', 'EFFECTIVE', 'SUPERSEDED', 'REJECTED')),
    confidence              NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
    predecessor_candidate_id BIGINT REFERENCES candidate_tariffs(id),
    raw_fields              JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_candidate_tariffs_jurisdiction ON candidate_tariffs(jurisdiction_code);
CREATE INDEX idx_candidate_tariffs_licensee ON candidate_tariffs(licensee_code);
CREATE INDEX idx_candidate_tariffs_status ON candidate_tariffs(status);
CREATE INDEX idx_candidate_tariffs_effective ON candidate_tariffs(effective_from, effective_to);

CREATE TABLE candidate_charge_components (
    id                  BIGSERIAL PRIMARY KEY,
    candidate_tariff_id BIGINT NOT NULL REFERENCES candidate_tariffs(id) ON DELETE CASCADE,
    charge_id           TEXT NOT NULL,
    charge_type         TEXT NOT NULL CHECK (charge_type IN
                            ('FIXED', 'DEMAND', 'ENERGY', 'TOD_SURCHARGE', 'TOD_REBATE', 'FAC_FPPAS',
                             'POWER_FACTOR_PENALTY', 'POWER_FACTOR_INCENTIVE', 'LOAD_FACTOR_INCENTIVE',
                             'REACTIVE_ENERGY', 'DUTY', 'TAX', 'CESS', 'MINIMUM_CHARGE', 'REBATE', 'OTHER')),
    value               NUMERIC(14,4) NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'INR',
    unit                TEXT NOT NULL,
    behaviour           TEXT NOT NULL CHECK (behaviour IN ('ADDITIVE', 'MULTIPLICATIVE', 'REBATE')),
    applicability        JSONB NOT NULL DEFAULT '{}',
    effective_from      DATE,
    effective_to        DATE,
    verification_status TEXT NOT NULL DEFAULT 'UNREVIEWED' CHECK (verification_status IN
                            ('UNREVIEWED', 'REVIEWED', 'REJECTED'))
);

CREATE INDEX idx_charge_components_candidate ON candidate_charge_components(candidate_tariff_id);

-- Provenance ---------------------------------------------------------------------

CREATE TABLE field_citations (
    id                      BIGSERIAL PRIMARY KEY,
    candidate_tariff_id     BIGINT REFERENCES candidate_tariffs(id) ON DELETE CASCADE,
    candidate_charge_id     BIGINT REFERENCES candidate_charge_components(id) ON DELETE CASCADE,
    document_id             TEXT NOT NULL REFERENCES source_documents(document_id),
    page_number             INTEGER,
    table_reference         TEXT,
    section_reference       TEXT,
    extracted_text          TEXT,
    extraction_method       TEXT NOT NULL,
    extraction_version      TEXT NOT NULL,
    confidence              NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (candidate_tariff_id IS NOT NULL OR candidate_charge_id IS NOT NULL)
);

CREATE INDEX idx_field_citations_tariff ON field_citations(candidate_tariff_id);
CREATE INDEX idx_field_citations_charge ON field_citations(candidate_charge_id);

-- Semantic diffs -------------------------------------------------------------------

CREATE TABLE semantic_change_sets (
    id                      BIGSERIAL PRIMARY KEY,
    candidate_tariff_id     BIGINT NOT NULL REFERENCES candidate_tariffs(id) ON DELETE CASCADE,
    baseline_tariff_id      BIGINT REFERENCES candidate_tariffs(id),
    change_kind             TEXT NOT NULL CHECK (change_kind IN
                                ('NEW_LICENSEE', 'REMOVED_LICENSEE', 'NEW_CATEGORY', 'REMOVED_CATEGORY',
                                 'EFFECTIVE_DATE_CHANGE', 'ENERGY_CHARGE_CHANGE', 'DEMAND_CHARGE_CHANGE',
                                 'FIXED_CHARGE_CHANGE', 'BILLING_BASIS_CHANGE', 'APPLICABILITY_CHANGE',
                                 'BILLING_DEMAND_RULE_CHANGE', 'TOD_CHANGE', 'FAC_FPPAS_CHANGE',
                                 'PF_LOAD_FACTOR_RULE_CHANGE', 'REBATE_CHANGE', 'RETROSPECTIVE_CORRECTION',
                                 'CITATION_ONLY')),
    summary                 TEXT NOT NULL,
    before_value             JSONB,
    after_value              JSONB,
    commercial_impact       TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (commercial_impact IN
                                ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_semantic_changes_candidate ON semantic_change_sets(candidate_tariff_id);

-- Validation -------------------------------------------------------------------------

CREATE TABLE validation_results (
    id                  BIGSERIAL PRIMARY KEY,
    candidate_tariff_id BIGINT NOT NULL REFERENCES candidate_tariffs(id) ON DELETE CASCADE,
    validation_layer    TEXT NOT NULL CHECK (validation_layer IN
                            ('SCHEMA', 'REFERENTIAL', 'TEMPORAL', 'UNIT', 'TIME_BAND', 'PROVENANCE',
                             'CATEGORY_RESOLUTION', 'COMMERCIAL_SANITY', 'GOLDEN_BILL', 'BESS_IMPACT')),
    severity            TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR')),
    message             TEXT NOT NULL,
    details             JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_validation_results_candidate ON validation_results(candidate_tariff_id);

-- Review / publication boundary -----------------------------------------------------

CREATE TABLE review_decisions (
    id                  BIGSERIAL PRIMARY KEY,
    candidate_tariff_id BIGINT NOT NULL REFERENCES candidate_tariffs(id) ON DELETE CASCADE,
    decision            TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'NEEDS_REVISION')),
    reviewer            TEXT NOT NULL,
    decided_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes               TEXT
);

CREATE INDEX idx_review_decisions_candidate ON review_decisions(candidate_tariff_id);

CREATE TABLE approved_tariffs (
    id                      BIGSERIAL PRIMARY KEY,
    candidate_tariff_id     BIGINT NOT NULL UNIQUE REFERENCES candidate_tariffs(id),
    review_decision_id      BIGINT NOT NULL REFERENCES review_decisions(id),
    approved_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    confidence_grade        TEXT NOT NULL CHECK (confidence_grade IN ('A', 'B', 'C', 'D', 'X')),
    superseded_by_tariff_id BIGINT REFERENCES approved_tariffs(id),
    effective_from          DATE NOT NULL,
    effective_to            DATE
);

CREATE TABLE dataset_releases (
    id                  BIGSERIAL PRIMARY KEY,
    version             TEXT NOT NULL UNIQUE,
    schema_version      TEXT NOT NULL,
    published_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    sha256              TEXT NOT NULL,
    jurisdictions_covered TEXT[] NOT NULL DEFAULT '{}',
    superseded_release_id BIGINT REFERENCES dataset_releases(id),
    manifest            JSONB NOT NULL
);

-- Scheduler / advisory locking -----------------------------------------------------

CREATE TABLE scheduler_locks (
    lock_name           TEXT PRIMARY KEY,
    holder              TEXT NOT NULL,
    acquired_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL
);

-- Source health observations -------------------------------------------------------

CREATE TABLE source_health_observations (
    id                  BIGSERIAL PRIMARY KEY,
    source_id           TEXT NOT NULL REFERENCES authoritative_sources(source_id),
    observed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    health              TEXT NOT NULL CHECK (health IN ('HEALTHY', 'DEGRADED', 'BLOCKED', 'MANUAL')),
    reason              TEXT,
    details             JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_source_health_source ON source_health_observations(source_id, observed_at DESC);

-- updated_at maintenance -------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jurisdictions_updated_at BEFORE UPDATE ON jurisdictions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_regulators_updated_at BEFORE UPDATE ON regulators
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_licensees_updated_at BEFORE UPDATE ON licensees
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sources_updated_at BEFORE UPDATE ON authoritative_sources
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_candidate_tariffs_updated_at BEFORE UPDATE ON candidate_tariffs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_extraction_jobs_updated_at BEFORE UPDATE ON extraction_jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
