-- Migration 013: Team Invitations
-- Adds the invitations table to support multi-user invite flow.
-- Status: pending → accepted | revoked | expired

create table if not exists invitations (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references users(id) on delete cascade,
  email          text        not null,
  role           text        not null default 'technician',
  invite_token   text        not null unique,
  status         text        not null default 'pending',
  invited_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  expires_at     timestamptz not null default (now() + interval '7 days'),
  updated_at     timestamptz not null default now()
);

-- Row Level Security
alter table invitations enable row level security;

-- Owners can see their own invitations
create policy "owners can view their invitations"
  on invitations for select
  using (user_id = auth.uid());

create policy "owners can insert invitations"
  on invitations for insert
  with check (user_id = auth.uid());

create policy "owners can update invitations"
  on invitations for update
  using (user_id = auth.uid());

create policy "owners can delete invitations"
  on invitations for delete
  using (user_id = auth.uid());

-- Index for token lookups (used on invite acceptance)
create index if not exists invitations_token_idx on invitations (invite_token);
create index if not exists invitations_user_id_idx on invitations (user_id);
