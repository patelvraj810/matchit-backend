-- Migration 011: Invoice job link + customer denormalisation
-- Allows invoices to be created directly from a completed job without requiring a lead
-- Denormalises customer info so invoices are self-contained (survive lead deletion)
-- Safe to run on existing data — all nullable columns

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_name  TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- Index for job-based invoice lookup (e.g. "has this job already been invoiced?")
CREATE INDEX IF NOT EXISTS idx_invoices_job_id      ON invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user_status ON invoices(user_id, status);
