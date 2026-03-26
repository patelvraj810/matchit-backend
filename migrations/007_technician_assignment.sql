-- Migration 007: Relational technician assignment for jobs
-- Safe to run on existing data — only adds a nullable column and index
-- technician_name TEXT column from migration 003 is kept for display / legacy compat
-- New FK column technician_id is the authoritative assignment reference

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS technician_id UUID REFERENCES team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_technician ON jobs(user_id, technician_id);

-- Note: Existing jobs with a technician_name but no technician_id remain valid.
-- The API will return technician_name from the joined team_member when technician_id is set,
-- and fall back to the legacy technician_name text field for old rows.
