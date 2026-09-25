-- PoppyGram Support — SQL migration
-- Creates the 4 support tables missing from the live Supabase DB:
--   support_tickets, support_messages, file_requests, feedback
-- Existing tables (bot_admins, bot_users, settings, audit_logs) are assumed
-- already present (they exist in supabase/schema.sql).
--
-- Source of truth for column names:
--   - pages/api/support.ts  (SELECT/INSERT/UPDATE column lists)
--   - pages/support.tsx     (TypeScript type definitions)
--   - api/support.py        (bot enum values: status, kind, priority, rating)
--   - prompttest.txt        (seed INSERT column order)
--
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
-- The site uses the server-only SUPABASE_SERVICE_ROLE_KEY everywhere
-- (see lib/db.ts), which bypasses RLS, so no RLS policies are required.

create extension if not exists pgcrypto;

-- =====================================================================
-- support_tickets
-- =====================================================================
create table if not exists support_tickets(
  id bigint generated always as identity primary key,
  kind text not null default 'general' check (kind in ('live','general')),
  subject text not null default '',
  status text not null default 'open' check (status in ('open','claimed','closed')),
  assigned_to text,           -- admin username who claimed it
  tg_user_id text,            -- Telegram user id (string; webapp does Number())
  username text default '',
  priority text not null default 'normal' check (priority in ('urgent','soon','normal')),
  closed_at timestamptz,      -- set by console close action
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_status_idx on support_tickets(status);
create index if not exists support_tickets_created_idx on support_tickets(created_at desc);
create index if not exists support_tickets_tg_user_idx on support_tickets(tg_user_id);
create index if not exists support_tickets_assigned_idx on support_tickets(assigned_to);

-- =====================================================================
-- support_messages
-- =====================================================================
create table if not exists support_messages(
  id bigint generated always as identity primary key,
  ticket_id bigint not null references support_tickets(id) on delete cascade,
  sender_role text not null default 'user' check (sender_role in ('user','admin')),
  text text not null default '',
  file_id text,               -- optional Telegram file id attached to a reply
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on support_messages(ticket_id);
create index if not exists support_messages_created_idx on support_messages(created_at asc);

-- =====================================================================
-- file_requests
-- =====================================================================
create table if not exists file_requests(
  id bigint generated always as identity primary key,
  tg_user_id text,
  username text default '',
  file_name text not null,
  description text default '',
  source_link text default '',
  priority text not null default 'normal' check (priority in ('urgent','soon','normal')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text default '',       -- admin note (set on reject)
  handled_by text,            -- admin username who handled it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists file_requests_status_idx on file_requests(status);
create index if not exists file_requests_created_idx on file_requests(created_at desc);
create index if not exists file_requests_tg_user_idx on file_requests(tg_user_id);

-- =====================================================================
-- feedback
-- =====================================================================
create table if not exists feedback(
  id bigint generated always as identity primary key,
  tg_user_id text,
  username text default '',
  rating smallint not null check (rating between 1 and 5),
  text text default '',
  category text default '',
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on feedback(created_at desc);
create index if not exists feedback_tg_user_idx on feedback(tg_user_id);

-- =====================================================================
-- Row-level security (matches existing app tables)
-- =====================================================================
alter table support_tickets enable row level security;
alter table support_messages enable row level security;
alter table file_requests enable row level security;
alter table feedback enable row level security;

-- =====================================================================
-- Timestamps auto-refresh on support_tickets (mirrors accounts/bot_users)
-- =====================================================================
create or replace function set_support_tickets_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists support_tickets_updated_at on support_tickets;
create trigger support_tickets_updated_at
  before update on support_tickets for each row
  execute function set_support_tickets_updated_at();

-- =====================================================================
-- Seed default support settings (read by getFaq() + Settings tab).
-- Uses ON CONFLICT DO NOTHING so re-runs are safe.
-- =====================================================================
insert into settings(key, value) values
  ('support_hours', '09:00-22:00 IST'),
  ('support_welcome', 'Thank you for reaching out! A support manager will reply shortly.'),
  ('support_offline_msg', '🕐 We are offline right now. Leave your message — a support manager will reply as soon as we are back. Your ticket stays open.'),
  ('support_auto_reply', '{"enabled":true}'),
  ('support_claim_timeout', '300'),
  ('support_faq', '{"Payment or credit problems":"Use /balance to check your credits, then /store to browse files. Credits are deducted at purchase.","Files that will not open or download":"Purchased files are delivered by the bot directly. If download fails, tell support your Telegram ID and the product name.","How do I contact support?":"Open @poppygramsupportbot in Telegram or use the Support webapp."}')
on conflict (key) do nothing;
