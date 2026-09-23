-- PoppyGram v2 schema
create extension if not exists pgcrypto;
-- Shared permanent store: EVERY account added by ANYONE with the site password
-- lives in this ONE table. No per-user separation — anyone with the password
-- sees ALL accounts. Rows are NEVER auto-deleted (permanent).
create table if not exists accounts(
 phone text primary key, label text default '', meta jsonb not null default '{}'::jsonb,
 session_encrypted text, status text not null default 'pending', ping_enabled boolean not null default true,
 last_ping timestamptz, next_ping_at timestamptz, ping_interval_minutes integer not null default 60,
 failure_count integer not null default 0, hard_ping_at timestamptz, previous_session_encrypted text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists accounts_next_ping_idx on accounts(ping_enabled,next_ping_at);
create index if not exists accounts_status_idx on accounts(status);

-- Permanent encrypted Telegram session history. Each successful Hard Reset
-- appends the previous active session here instead of overwriting a single backup.
create table if not exists account_session_backups (
  id bigint generated always as identity primary key,
  phone text not null references accounts(phone) on delete cascade,
  session_encrypted text not null,
  captured_at timestamptz not null default now(),
  reason text not null default 'hard_reset',
  verified boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists account_session_backups_phone_idx
  on account_session_backups(phone, captured_at desc);

create index if not exists account_session_backups_created_idx
  on account_session_backups(created_at desc);

create table if not exists audit_logs(id bigint generated always as identity primary key,event text not null,message text,created_at timestamptz not null default now());
create index if not exists audit_logs_created_idx on audit_logs(created_at desc);

create table if not exists processed_updates(
 update_id bigint primary key,
 created_at timestamptz not null default now()
);
create index if not exists processed_updates_created_idx on processed_updates(created_at desc);

create table if not exists settings(key text primary key,value text not null,updated_at timestamptz not null default now());
insert into settings(key,value) values('site_name','PoppyGram'),('ping_interval_minutes','60'),('max_attempts','3'),('global_credit','100'),('admin_logout_before','1970-01-01T00:00:00.000Z') on conflict(key) do nothing;
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
alter table account_session_backups enable row level security;

-- Hard reset metadata: the latest session replaces the active session, while the previous encrypted session is retained as a recovery backup.
alter table accounts add column if not exists hard_ping_at timestamptz;
alter table accounts add column if not exists previous_session_encrypted text;


-- Existing previous_session_encrypted is retained for backward compatibility.
-- New Hard Reset operations use account_session_backups as the permanent history.


-- Telegram Store / Wallet
-- Credits shown by the bot are now real per-user store credits.
create table if not exists bot_users(
  tg_user_id text primary key,
  username text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  credit numeric(14,2) not null default 0 check(credit >= 0),
  auth_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists bot_users_username_idx on bot_users(username) where username <> '';
create index if not exists bot_users_credit_idx on bot_users(credit desc);
alter table bot_users add column if not exists auth_verified boolean not null default false;
alter table bot_users add column if not exists free_credits_claimed_at timestamptz;
alter table bot_users add column if not exists auth_credit_granted_at timestamptz;

create table if not exists bot_admins(
  id bigint generated always as identity primary key,
  username text not null unique,
  active boolean not null default true,
  added_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tg_chat_id text
);
alter table bot_admins add column if not exists tg_chat_id text;
create index if not exists bot_admins_chat_idx on bot_admins(tg_chat_id);

create table if not exists store_products(
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  price numeric(14,2) not null default 0 check(price >= 0),
  telegram_file_id text not null,
  telegram_file_unique_id text not null default '',
  file_name text not null default 'file',
  file_size bigint not null default 0,
  uploaded_by text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists store_products_active_idx on store_products(active,created_at desc);

create table if not exists store_purchases(
  id bigint generated always as identity primary key,
  tg_user_id text not null references bot_users(tg_user_id) on delete cascade,
  product_id bigint not null references store_products(id),
  price numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists store_purchases_user_idx on store_purchases(tg_user_id,created_at desc);

alter table bot_users enable row level security;
alter table bot_admins enable row level security;
alter table store_products enable row level security;
alter table store_purchases enable row level security;

create or replace function change_bot_credit(p_tg_user_id text,p_delta numeric)
returns numeric
language plpgsql
security definer
set search_path=public
as $$
declare new_balance numeric;
begin
  update bot_users
    set credit=credit+p_delta,updated_at=now()
    where tg_user_id=p_tg_user_id and credit+p_delta>=0
    returning credit into new_balance;
  if new_balance is null then
    raise exception 'INSUFFICIENT_CREDITS_OR_USER_NOT_FOUND';
  end if;
  return new_balance;
end;
$$;

create or replace function purchase_store_product(p_tg_user_id text,p_product_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  u_balance numeric;
  p_price numeric;
  u_username text;
  unlimited boolean := false;
begin
  select credit, username into u_balance, u_username from bot_users where tg_user_id=p_tg_user_id for update;
  if u_balance is null then return jsonb_build_object('ok',false,'error','User wallet not found'); end if;

  select price into p_price from store_products where id=p_product_id and active=true;
  if p_price is null then return jsonb_build_object('ok',false,'error','Product is unavailable'); end if;

  select (lower(coalesce(u_username,''))='drangeljangra' or exists(
    select 1 from bot_admins ba where lower(ba.username)=lower(coalesce(u_username,'')) and ba.active=true
  )) into unlimited;

  if unlimited then
    insert into store_purchases(tg_user_id,product_id,price) values(p_tg_user_id,p_product_id,p_price);
    return jsonb_build_object('ok',true,'balance',null,'unlimited',true,'price',p_price);
  end if;

  if u_balance < p_price then
    return jsonb_build_object('ok',false,'error','Not enough credits');
  end if;

  update bot_users set credit=credit-p_price,updated_at=now() where tg_user_id=p_tg_user_id;
  insert into store_purchases(tg_user_id,product_id,price) values(p_tg_user_id,p_product_id,p_price);
  return jsonb_build_object('ok',true,'balance',u_balance-p_price,'unlimited',false,'price',p_price);
end;
$$;

-- Keep bot wallet timestamps current.
create or replace function set_bot_user_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists bot_users_updated_at on bot_users;
create trigger bot_users_updated_at before update on bot_users for each row execute function set_bot_user_updated_at();

-- Seed the fixed owner as an administrative identity. It is also recognized in code.
insert into bot_admins(username,active,added_by)
values('drangeljangra',true,'owner')
on conflict(username) do update set active=true;


-- Claimable free credits: one 100-credit claim per authenticated user every 24 hours.
create or replace function claim_free_credits(p_tg_user_id text,p_amount numeric default 100)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r bot_users%rowtype; next_at timestamptz;
begin
  select * into r from bot_users where tg_user_id=p_tg_user_id for update;
  if not found then return jsonb_build_object('ok',false,'error','User wallet not found'); end if;
  if not r.auth_verified then return jsonb_build_object('ok',false,'error','Authentication required'); end if;
  if r.free_credits_claimed_at is not null and r.free_credits_claimed_at > now()-interval '24 hours' then
    next_at:=r.free_credits_claimed_at+interval '24 hours';
    return jsonb_build_object('ok',false,'balance',r.credit,'next_at',next_at,'error','24 hour cooldown active');
  end if;
  update bot_users set credit=credit+greatest(p_amount,0),free_credits_claimed_at=now(),updated_at=now() where tg_user_id=p_tg_user_id returning credit into r.credit;
  return jsonb_build_object('ok',true,'balance',r.credit,'next_at',now()+interval '24 hours');
end;
$$;

-- Delete only Telegram bot memory. Never delete the authenticated accounts table or encrypted sessions.
create or replace function delete_bot_memory(p_tg_user_id text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  delete from bot_users where tg_user_id=p_tg_user_id;
  return true;
end;
$$;

-- v10 authentication ownership marker. Existing accounts remain untouched; this only
-- provides a stable server-side link when available for future verification checks.
alter table accounts add column if not exists auth_owner_tg_id text;
create index if not exists accounts_auth_owner_tg_id_idx on accounts(auth_owner_tg_id);
-- Telegram bot ownership is the bot chat/user ID, not the authenticated MTProto account ID.
-- New logins store bot_tg_id in accounts.meta and auth_owner_tg_id as the bot user ID.
