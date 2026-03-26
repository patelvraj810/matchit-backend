-- Migration 012: Public estimate links
-- Enables customer-facing estimate review and approval without requiring login
-- Safe to run on existing data

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS public_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS public_viewed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_estimates_public_token
  ON estimates(public_token)
  WHERE public_token IS NOT NULL;
