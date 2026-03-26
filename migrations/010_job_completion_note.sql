-- Migration 010: Job completion note
-- Adds a dedicated field for technician visit summary / completion note
-- Separate from dispatcher-facing notes to avoid overwriting scheduling context
-- Safe to run on existing data — nullable column

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS completion_note TEXT;

-- Index not needed — completion notes are only read on single-job fetch
