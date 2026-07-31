-- India tariff crawler: acquisition-provider and fetch-integrity provenance.
-- Additive only. Supports:
--   - the HTTP/Firecrawl/AUTO acquisition-provider abstraction (crawler
--     architecture: source adapter describes how a page is interpreted,
--     acquisition provider describes how it is acquired);
--   - recording which provider actually served a given fetch, and why an
--     AUTO-mode fallback happened, if it did;
--   - recording whether MIME-type and PDF-magic-byte validation were
--     actually performed and what they found, so "a document was archived"
--     and "a document was archived after passing integrity checks" are
--     distinguishable in the data, not just asserted by code review.

ALTER TABLE fetch_observations
    ADD COLUMN IF NOT EXISTS acquisition_provider TEXT NOT NULL DEFAULT 'HTTP'
        CHECK (acquisition_provider IN ('HTTP', 'FIRECRAWL')),
    ADD COLUMN IF NOT EXISTS acquisition_fallback_reason TEXT,
    ADD COLUMN IF NOT EXISTS firecrawl_job_id TEXT,
    ADD COLUMN IF NOT EXISTS mime_validated BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pdf_magic_bytes_valid BOOLEAN;

ALTER TABLE authoritative_sources
    ADD COLUMN IF NOT EXISTS acquisition_mode TEXT NOT NULL DEFAULT 'AUTO'
        CHECK (acquisition_mode IN ('HTTP', 'FIRECRAWL', 'AUTO'));

CREATE INDEX IF NOT EXISTS idx_fetch_obs_provider ON fetch_observations(acquisition_provider);
