-- =====================================================
-- Migration: Add auth fields to users table
-- Project: leadclaw
-- Date: 2026-03-24
-- =====================================================
-- Run this in: Supabase Dashboard > SQL Editor
-- OR via Supabase CLI: supabase db push
-- =====================================================

-- Step 1: Add password_hash column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Step 2: Add business_name column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT;

-- Step 3: Add industry column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS industry TEXT;

-- Step 4: Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('password_hash', 'business_name', 'industry');

-- =====================================================
-- To apply via Supabase CLI, run:
-- cd ~/leadclaw-backend && supabase db push
-- =====================================================
