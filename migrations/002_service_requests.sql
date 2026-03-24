-- Matchit Find — Service Requests Table
-- Stores public service requests submitted via /api/find/request
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  urgency TEXT,
  description TEXT,
  contact_phone TEXT NOT NULL,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
