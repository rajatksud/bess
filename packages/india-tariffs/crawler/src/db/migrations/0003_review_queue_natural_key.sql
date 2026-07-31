-- India tariff crawler: give licensee_review_queue a stable natural key.
-- Additive only. licensee_review_queue (added in 0002_expand_registry) used
-- only a surrogate BIGSERIAL id, which prevents an idempotent upsert keyed
-- on the human-authored review_id used in registry/licensee_review_queue.yaml
-- (registryLoader.ts is the only writer, per its own header comment, and
-- needs ON CONFLICT DO UPDATE support like every other registry table).

ALTER TABLE licensee_review_queue
    ADD COLUMN IF NOT EXISTS review_id TEXT;

-- Backfill is a no-op on a fresh/empty table (the common case, since this
-- table was only just introduced in 0002 and no review-queue loader existed
-- until now); harmless if rows do already exist without a review_id.
UPDATE licensee_review_queue SET review_id = 'RQ-LEGACY-' || id WHERE review_id IS NULL;

ALTER TABLE licensee_review_queue
    ALTER COLUMN review_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_queue_review_id ON licensee_review_queue(review_id);
