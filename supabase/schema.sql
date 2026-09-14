-- PoppyGram v2 schema
create extension if not exists pgcrypto;
-- Shared permanent store: EVERY account added by ANYONE with the site password
-- lives in this ONE table. No per-user separation — anyone with the password
-- sees ALL accounts. Rows are NEVER auto-deleted (permanent).
create table if not exists accounts(
 phone text primary key, label text default '', meta jsonb not null default '{}'::jsonb,
 session_encrypted text, status text not null default 'pending', ping_enabled boolean not null default true,
 last_ping timestamptz, next_ping_at timestamptz, ping_interval_minutes integer not null default 60,
 failure_count integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists accounts_next_ping_idx on accounts(ping_enabled,next_ping_at);
create index if not exists accounts_status_idx on accounts(status);
create table if not exists audit_logs(id bigint generated always as identity primary key,event text not null,message text,created_at timestamptz not null default now());
create index if not exists audit_logs_created_idx on audit_logs(created_at desc);

create table if not exists processed_updates(
 update_id bigint primary key,
 created_at timestamptz not null default now()
);
create index if not exists processed_updates_created_idx on processed_updates(created_at desc);

create table if not exists settings(key text primary key,value text not null,updated_at timestamptz not null default now());
insert into settings(key,value) values('site_name','PoppyGram'),('ping_interval_minutes','60'),('max_attempts','3'),('global_credit','100') on conflict(key) do nothing;
-- Temporary state for interactive Telegram login (phone -> code -> 2FA). Rows are deleted on completion.
create table if not exists login_sessions(phone text primary key,data jsonb not null,created_at timestamptz not null default now());
-- The application uses the Supabase service-role key only on the server.
-- Never expose SUPABASE_SERVICE_ROLE_KEY to browser code.
-- Permanent storage: no DELETE triggers / TTL policies on accounts. Do not add row-deletion crons.


-- Data integrity constraints (safe to run after the tables already exist).
alter table accounts drop constraint if exists accounts_status_check;
alter table accounts add constraint accounts_status_check check (status in ('pending','active','needs_attention','error'));
alter table accounts drop constraint if exists accounts_interval_check;
alter table accounts add constraint accounts_interval_check check (ping_interval_minutes between 5 and 10080);
alter table accounts drop constraint if exists accounts_failure_check;
alter table accounts add constraint accounts_failure_check check (failure_count >= 0 and failure_count <= 100);

create or replace function set_accounts_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists accounts_updated_at on accounts;
create trigger accounts_updated_at before update on accounts for each row execute function set_accounts_updated_at();

-- Lock down all application tables. The app uses the server-only Supabase service role,
-- which bypasses RLS. With RLS enabled and no public policies, anon/authenticated clients
-- cannot read or mutate account/session/audit data directly.
alter table accounts enable row level security;
alter table audit_logs enable row level security;
alter table settings enable row level security;
alter table login_sessions enable row level security;
alter table processed_updates enable row level security;
