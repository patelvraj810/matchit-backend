-- Migration 014: Connected Integrations
-- Persists real integration connection state per workspace.
-- Replaces the static hardcoded state in the frontend.
-- Connection patterns: env_detected (from env vars), oauth, api_key, webhook, manual

create table if not exists connected_integrations (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references users(id) on delete cascade,
  provider       text        not null,
  status         text        not null default 'disconnected',
  connection_type text       not null default 'manual',
  account_label  text,
  config         jsonb       not null default '{}',
  last_sync_at   timestamptz,
  error_message  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique(user_id, provider)
);

-- Row Level Security
alter table connected_integrations enable row level security;

create policy "owners can view their integrations"
  on connected_integrations for select
  using (user_id = auth.uid());

create policy "owners can insert integrations"
  on connected_integrations for insert
  with check (user_id = auth.uid());

create policy "owners can update integrations"
  on connected_integrations for update
  using (user_id = auth.uid());

create policy "owners can delete integrations"
  on connected_integrations for delete
  using (user_id = auth.uid());

create index if not exists integrations_user_id_idx on connected_integrations (user_id);
create index if not exists integrations_provider_idx on connected_integrations (user_id, provider);
