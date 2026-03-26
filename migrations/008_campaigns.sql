-- Migration 008: Campaigns — automated outreach sequences
-- Run in Supabase SQL editor after 001-007

CREATE TABLE IF NOT EXISTS campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name             TEXT        NOT NULL,
  type             TEXT        NOT NULL
                               CHECK (type IN ('review_request', 'stale_lead', 'quote_followup', 'post_job')),
  channel          TEXT        NOT NULL DEFAULT 'whatsapp'
                               CHECK (channel IN ('whatsapp', 'email', 'sms')),
  status           TEXT        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'active', 'paused', 'archived')),

  -- 'all', 'qualified', 'unresponded', 'completed_jobs', 'sent_estimates'
  target_segment   TEXT        NOT NULL DEFAULT 'all',
  message_template TEXT,
  delay_hours      INTEGER     NOT NULL DEFAULT 24,

  -- 'job_completed', 'estimate_sent', 'lead_stale', 'manual'
  trigger_event    TEXT,

  sent_count       INTEGER     NOT NULL DEFAULT 0,
  notes            TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user   ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(user_id, status);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own campaigns"
  ON campaigns FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
