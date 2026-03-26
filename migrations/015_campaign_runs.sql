-- Migration 015: Campaign Runs / Execution Log
-- Records each time a campaign was triggered, what was sent, and the outcome.
-- This is the foundation for the campaign execution engine.

create table if not exists campaign_runs (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references users(id) on delete cascade,
  campaign_id      uuid        not null references campaigns(id) on delete cascade,
  trigger_type     text        not null,
  entity_id        uuid,
  entity_type      text,
  status           text        not null default 'queued',
  channel          text,
  recipient_phone  text,
  recipient_email  text,
  message_sent     text,
  error_message    text,
  triggered_at     timestamptz not null default now(),
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);

alter table campaign_runs enable row level security;

create policy "owners can view their campaign runs"
  on campaign_runs for select
  using (user_id = auth.uid());

create policy "owners can insert campaign runs"
  on campaign_runs for insert
  with check (user_id = auth.uid());

create policy "owners can update campaign runs"
  on campaign_runs for update
  using (user_id = auth.uid());

create index if not exists campaign_runs_campaign_id_idx on campaign_runs (campaign_id);
create index if not exists campaign_runs_user_id_idx on campaign_runs (user_id);
create index if not exists campaign_runs_triggered_at_idx on campaign_runs (triggered_at desc);

-- Add last_run_at to campaigns table for quick display
alter table campaigns add column if not exists last_run_at timestamptz;
alter table campaigns add column if not exists run_count   integer not null default 0;
