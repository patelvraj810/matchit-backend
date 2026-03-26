-- Migration 006: Team Members
-- Employees, technicians, dispatchers under a business owner account
-- Run in Supabase SQL editor after 001-005

CREATE TABLE IF NOT EXISTS team_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name        TEXT        NOT NULL,
  email       TEXT,
  phone       TEXT,

  role        TEXT        NOT NULL DEFAULT 'technician'
              CHECK (role IN ('owner', 'admin', 'dispatcher', 'technician')),

  title       TEXT,           -- e.g. "Lead HVAC Tech", "Office Manager"
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  notes       TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_members_user   ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_active ON team_members(user_id, is_active);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own team"
  ON team_members FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
