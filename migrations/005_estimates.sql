-- Migration 005: Estimates / Proposals
-- Pre-job conversion engine: lead -> quote -> approval -> deposit -> job
-- Run in Supabase SQL editor after 001-004

CREATE TABLE IF NOT EXISTS estimates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id           UUID        REFERENCES leads(id) ON DELETE SET NULL,
  conversation_id   UUID        REFERENCES conversations(id) ON DELETE SET NULL,

  -- Customer snapshot (denormalised so estimate survives lead deletion)
  customer_name     TEXT        NOT NULL,
  customer_phone    TEXT,
  customer_email    TEXT,

  -- Status lifecycle: draft -> sent -> approved | declined | expired
  --                   approved -> deposit_paid -> converted
  status            TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','approved','declined','expired','deposit_paid','converted')),

  -- Line items stored as JSONB array
  -- Each item: { id, name, description, quantity, unit_price, unit, total }
  line_items        JSONB       NOT NULL DEFAULT '[]',

  -- Financials
  subtotal          DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax_rate          DECIMAL(5,4)  NOT NULL DEFAULT 0.13,
  tax_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
  total             DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposit_amount    DECIMAL(10,2),           -- optional deposit required before work starts

  -- Dates
  expires_at        TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  declined_at       TIMESTAMPTZ,
  deposit_paid_at   TIMESTAMPTZ,

  -- Job created after approval/deposit
  converted_job_id  UUID        REFERENCES jobs(id) ON DELETE SET NULL,

  -- Internal notes (not shown to customer)
  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_estimates_user_id    ON estimates(user_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status     ON estimates(user_id, status);
CREATE INDEX IF NOT EXISTS idx_estimates_lead_id    ON estimates(lead_id);
CREATE INDEX IF NOT EXISTS idx_estimates_created_at ON estimates(user_id, created_at DESC);

-- RLS
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own estimates"
  ON estimates FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
