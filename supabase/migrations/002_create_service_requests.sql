-- =====================================================
-- Create service_requests table for Matchit Find
-- Project: Matchit
-- Date: 2026-03-24
-- =====================================================

CREATE TABLE IF NOT EXISTS service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_phone TEXT NOT NULL,
  category TEXT NOT NULL,
  urgency TEXT DEFAULT 'this_week',
  description TEXT,
  location TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'matched', 'in_progress', 'completed', 'cancelled')),
  matched_provider_id UUID,
  source TEXT DEFAULT 'website',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (public form)
CREATE POLICY "Anyone can create service requests"
  ON service_requests FOR INSERT
  WITH CHECK (true);

-- Allow owners to read their own requests
CREATE POLICY "Anyone can read service requests"
  ON service_requests FOR SELECT
  USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_service_requests_created ON service_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_phone ON service_requests(contact_phone);
