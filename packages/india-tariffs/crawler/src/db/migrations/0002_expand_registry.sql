-- India tariff crawler: national registry expansion.
-- Additive only (per docs/data/INDIA_CI_TARIFF_DATA_STRATEGY.md section 8.4 /
-- crawler architecture "migrations are additive"). Adds columns and tables
-- needed to represent: regulator tariff/schedule portals and source health;
-- licensee coverage tier, ownership, C&I relevance, verification state,
-- predecessor/successor/overlap/parent relationships and shared tariff
-- groups; per-source jurisdiction linkage, multi-licensee sources and live
-- health-probe results.

-- Regulators: additional identity/portal/health fields --------------------------

ALTER TABLE regulators
    ADD COLUMN IF NOT EXISTS schedule_portal_url TEXT,
    ADD COLUMN IF NOT EXISTS evidence_url        TEXT,
    ADD COLUMN IF NOT EXISTS source_health        TEXT NOT NULL DEFAULT 'NOT_CHECKED'
        CHECK (source_health IN ('HEALTHY', 'DEGRADED', 'BLOCKED', 'MANUAL', 'NOT_CHECKED'));

-- Licensees: tier, ownership, relevance, verification, relationships ------------

ALTER TABLE licensees
    ADD COLUMN IF NOT EXISTS coverage_tier             TEXT NOT NULL DEFAULT 'TIER_A'
        CHECK (coverage_tier IN ('TIER_A', 'TIER_B', 'TIER_C')),
    ADD COLUMN IF NOT EXISTS ownership_type             TEXT NOT NULL DEFAULT 'UNKNOWN'
        CHECK (ownership_type IN ('STATE_GOVERNMENT', 'PRIVATE', 'MUNICIPAL_BODY', 'CENTRAL_GOVERNMENT', 'COOPERATIVE', 'MIXED', 'UNKNOWN')),
    ADD COLUMN IF NOT EXISTS c_and_i_relevance         TEXT NOT NULL DEFAULT 'MEDIUM'
        CHECK (c_and_i_relevance IN ('HIGH', 'MEDIUM', 'LOW', 'NONE')),
    ADD COLUMN IF NOT EXISTS shared_tariff_group_id    TEXT,
    ADD COLUMN IF NOT EXISTS predecessor_licensee_ids  TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS successor_licensee_ids    TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS overlap_licensee_ids      TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS parent_licensee_id        TEXT REFERENCES licensees(code),
    ADD COLUMN IF NOT EXISTS verification_status       TEXT NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (verification_status IN ('VERIFIED', 'PROVISIONAL', 'UNVERIFIED', 'DISPUTED')),
    ADD COLUMN IF NOT EXISTS confidence                TEXT
        CHECK (confidence IS NULL OR confidence IN ('HIGH', 'MEDIUM', 'LOW')),
    ADD COLUMN IF NOT EXISTS authoritative_source_ids   TEXT[] NOT NULL DEFAULT '{}';

-- Widen the status check to the three-state ACTIVE/INACTIVE/UNCERTAIN model
-- used going forward (UNKNOWN retained for backward compatibility with any
-- already-loaded rows; new loads use UNCERTAIN).
ALTER TABLE licensees DROP CONSTRAINT IF EXISTS licensees_status_check;
ALTER TABLE licensees ADD CONSTRAINT licensees_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'UNKNOWN', 'UNCERTAIN'));

CREATE INDEX IF NOT EXISTS idx_licensees_coverage_tier ON licensees(coverage_tier);
CREATE INDEX IF NOT EXISTS idx_licensees_status ON licensees(status);
CREATE INDEX IF NOT EXISTS idx_licensees_parent ON licensees(parent_licensee_id);

-- Shared tariff groups: many-to-many licensee <-> common schedule ---------------

CREATE TABLE IF NOT EXISTS shared_tariff_groups (
    group_id            TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    regulator_code      TEXT NOT NULL REFERENCES regulators(code),
    basis               TEXT CHECK (basis IN
                            ('COMMON_MYT_ORDER', 'CEILING_TARIFF_ADOPTED', 'SINGLE_ELECTRICITY_DEPARTMENT',
                             'JERC_COMMON_SCHEDULE', 'OTHER')),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared_tariff_group_jurisdictions (
    group_id            TEXT NOT NULL REFERENCES shared_tariff_groups(group_id) ON DELETE CASCADE,
    jurisdiction_code   TEXT NOT NULL REFERENCES jurisdictions(code),
    PRIMARY KEY (group_id, jurisdiction_code)
);

CREATE TABLE IF NOT EXISTS shared_tariff_group_licensees (
    group_id            TEXT NOT NULL REFERENCES shared_tariff_groups(group_id) ON DELETE CASCADE,
    licensee_code       TEXT NOT NULL REFERENCES licensees(code),
    PRIMARY KEY (group_id, licensee_code)
);

CREATE TABLE IF NOT EXISTS shared_tariff_group_sources (
    group_id            TEXT NOT NULL REFERENCES shared_tariff_groups(group_id) ON DELETE CASCADE,
    source_id           TEXT NOT NULL REFERENCES authoritative_sources(source_id),
    PRIMARY KEY (group_id, source_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'licensees_shared_tariff_group_fkey'
    ) THEN
        ALTER TABLE licensees
            ADD CONSTRAINT licensees_shared_tariff_group_fkey
            FOREIGN KEY (shared_tariff_group_id) REFERENCES shared_tariff_groups(group_id);
    END IF;
END $$;

CREATE TRIGGER trg_shared_tariff_groups_updated_at BEFORE UPDATE ON shared_tariff_groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Authoritative sources: jurisdiction linkage, multi-licensee, live health -------

ALTER TABLE authoritative_sources
    ADD COLUMN IF NOT EXISTS jurisdiction_code   TEXT REFERENCES jurisdictions(code),
    ADD COLUMN IF NOT EXISTS licensee_codes      TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS source_health        TEXT NOT NULL DEFAULT 'NOT_CHECKED'
        CHECK (source_health IN ('HEALTHY', 'DEGRADED', 'BLOCKED', 'MANUAL', 'NOT_CHECKED')),
    ADD COLUMN IF NOT EXISTS last_live_check_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sources_jurisdiction_code ON authoritative_sources(jurisdiction_code);
CREATE INDEX IF NOT EXISTS idx_sources_health ON authoritative_sources(source_health);

-- Unresolved-entity review queue (Tier C / ambiguous entities) -------------------

CREATE TABLE IF NOT EXISTS licensee_review_queue (
    id                  BIGSERIAL PRIMARY KEY,
    candidate_name      TEXT NOT NULL,
    jurisdiction_code   TEXT REFERENCES jurisdictions(code),
    reason              TEXT NOT NULL,
    evidence_checked    TEXT,
    suggested_next_step TEXT,
    related_licensee_code TEXT REFERENCES licensees(code),
    status              TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_queue_jurisdiction ON licensee_review_queue(jurisdiction_code);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON licensee_review_queue(status);

CREATE TRIGGER trg_review_queue_updated_at BEFORE UPDATE ON licensee_review_queue
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
