-- Migration 009: Agent behavior settings
-- Adds behavior JSONB to agents table for storing intelligence flags
-- and objection handlers — safe to run on existing data (adds nullable column)

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS behavior JSONB NOT NULL DEFAULT '{}';

-- Expected behavior JSON shape:
-- {
--   "spin_selling":         true,
--   "auto_mode_switch":     true,
--   "one_question":         true,
--   "push_booking":         true,
--   "auto_nurture":         true,
--   "attempt_upsell":       false,
--   "escalate_frustrated":  false,
--   "objections": [
--     { "trigger": "too expensive", "response": "We offer flexible payment options..." },
--     { "trigger": "need to think about it", "response": "Of course — can I ask what's the main thing holding you back?" }
--   ]
-- }
