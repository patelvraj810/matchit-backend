-- Matchit — Jobs, Price Book, Channels
-- Run this in Supabase SQL Editor after 001 and 002

-- Jobs table (appointments/work orders)
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  job_description TEXT NOT NULL,
  service_type TEXT,
  address TEXT,
  scheduled_date DATE,
  scheduled_time TIME,
  duration_hours DECIMAL(4,2) DEFAULT 2,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','in_progress','completed','cancelled')),
  price DECIMAL(10,2),
  notes TEXT,
  technician_name TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Price book items
CREATE TABLE IF NOT EXISTS pricebook_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  unit_price DECIMAL(10,2) NOT NULL,
  unit TEXT DEFAULT 'each',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add opening_message column to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS opening_message TEXT;

-- Add channels config to agents (JSONB array of channel objects)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS channels JSONB DEFAULT '[]'::jsonb;

-- Add phone and owner_whatsapp to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_whatsapp TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'starter';

-- Add owner_phone to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_phone TEXT;

-- Index jobs by user and date
CREATE INDEX IF NOT EXISTS idx_jobs_user_date ON jobs(user_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pricebook_user ON pricebook_items(user_id);
