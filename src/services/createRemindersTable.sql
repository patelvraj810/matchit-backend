-- Create reminders table for appointment reminder system
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  owner_phone TEXT,
  type TEXT NOT NULL CHECK (type IN ('24h', '2h', '30min')),
  message TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying pending reminders
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_reminders_booking ON reminders(booking_id);
