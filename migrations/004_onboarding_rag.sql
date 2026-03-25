-- Migration 004: Onboarding RAG — business documents + onboarding state
-- Run in Supabase SQL editor

-- 1. Business documents table (RAG knowledge base per business)
CREATE TABLE IF NOT EXISTS business_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_name    TEXT NOT NULL,
  doc_type    TEXT NOT NULL DEFAULT 'general', -- 'pricing', 'faq', 'about', 'general'
  raw_content TEXT NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_documents_user_id ON business_documents(user_id);

-- 2. Add onboarding flag to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- 3. Add AI agent fields (some may already exist from 003, use IF NOT EXISTS)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS google_review_link  TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS emergency_available BOOLEAN DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS operating_hours     JSONB DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS selected_sources    TEXT[] DEFAULT '{}';

-- 4. RLS on business_documents
ALTER TABLE business_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own business_documents"
  ON business_documents
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
