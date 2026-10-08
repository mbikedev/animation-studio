-- Animation Studio: initial schema, RLS and transactional functions.
-- Money: integer minor units + currency. Credits: integers. No floats.
-- All mutation functions are SECURITY DEFINER and executable by service_role
-- only: browsers can read their own rows (RLS) but never write credits,
-- roles, payment states or provider costs.

-- gen_random_uuid() is built into PostgreSQL 13+.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text check (char_length(display_name) <= 80),
  locale text not null default 'fr' check (locale in ('fr', 'en', 'nl')),
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index projects_owner_updated_idx on public.projects (owner_id, updated_at desc);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  kind text not null check (kind in ('image', 'audio', 'video')),
  bucket text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  duration_ms integer check (duration_ms >= 0),
  width integer check (width > 0),
  height integer check (height > 0),
  checksum text,
  status text not null default 'pending_upload' check (status in ('pending_upload', 'ready', 'rejected', 'deleted')),
  created_at timestamptz not null default now()
);
create index assets_owner_created_idx on public.assets (owner_id, created_at desc);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id),
  provider text not null,
  model_id text not null,
  provider_job_id text,
  status text not null default 'queued' check (status in (
    'queued', 'preparing_audio', 'submitting', 'processing', 'storing',
    'succeeded', 'failed', 'canceled', 'needs_reconciliation')),
  parameters jsonb not null,
  image_asset_id uuid not null references public.assets (id),
  audio_asset_id uuid references public.assets (id),
  output_asset_id uuid references public.assets (id),
  reserved_credits integer not null check (reserved_credits >= 0),
  price_version text not null,
  estimated_cost_minor bigint not null check (estimated_cost_minor >= 0),
  actual_cost_minor bigint check (actual_cost_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  error_code text,
  error_message text,
  idempotency_key text not null,
  budget_day date not null,
  attempts integer not null default 0 check (attempts >= 0),
  next_check_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);
create index generations_owner_created_idx on public.generations (owner_id, created_at desc);
create index generations_status_created_idx on public.generations (status, created_at desc);
create index generations_provider_job_idx on public.generations (provider_job_id) where provider_job_id is not null;
create index generations_due_idx on public.generations (next_check_at) where next_check_at is not null;

create table public.credit_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  available_credits integer not null default 0 check (available_credits >= 0),
  reserved_credits integer not null default 0 check (reserved_credits >= 0),
  updated_at timestamptz not null default now()
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  generation_id uuid references public.generations (id),
  event_type text not null check (event_type in (
    'signup_bonus', 'purchase', 'reserve', 'consume', 'release', 'admin_adjustment', 'refund_reversal')),
  available_delta integer not null,
  reserved_delta integer not null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index credit_ledger_user_created_idx on public.credit_ledger (user_id, created_at desc);

create table public.credit_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credits integer not null check (credits > 0),
  stripe_price_id text unique,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pack_id uuid not null references public.credit_packs (id),
  credits_snapshot integer not null check (credits_snapshot > 0),
  stripe_session_id text unique,
  payment_status text not null default 'pending' check (payment_status in (
    'pending', 'paid', 'async_pending', 'failed', 'expired', 'refunded', 'disputed')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  credited_at timestamptz,
  created_at timestamptz not null default now()
);
create index purchases_user_created_idx on public.purchases (user_id, created_at desc);

create table public.webhook_events (
  provider text not null,
  event_id text not null,
  payload_hash text not null,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table public.job_outbox (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null unique references public.generations (id) on delete cascade,
  dispatch_status text not null default 'pending' check (dispatch_status in ('pending', 'dispatched', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index job_outbox_due_idx on public.job_outbox (next_attempt_at) where dispatch_status <> 'dispatched';

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  sanitized_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.budget_days (
  day date primary key,
  reserved_minor bigint not null default 0 check (reserved_minor >= 0),
  spent_minor bigint not null default 0 check (spent_minor >= 0)
);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- Assets attached to a project must belong to the same owner.
create function public.assets_owner_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.owner_id = new.owner_id
  ) then
    raise exception 'asset project owner mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger assets_owner_guard before insert or update on public.assets
for each row execute function public.assets_owner_guard();

-- Generation transitions (mirror of src/lib/generation/state-machine.ts).
create function public.generation_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable as $$
  select p_from = p_to and p_from in ('preparing_audio', 'submitting', 'processing', 'storing')
      or (p_from, p_to) in (
        ('queued', 'preparing_audio'), ('queued', 'submitting'), ('queued', 'failed'), ('queued', 'canceled'),
        ('preparing_audio', 'submitting'), ('preparing_audio', 'failed'), ('preparing_audio', 'needs_reconciliation'), ('preparing_audio', 'canceled'),
        ('submitting', 'processing'), ('submitting', 'failed'), ('submitting', 'needs_reconciliation'),
        ('processing', 'storing'), ('processing', 'failed'), ('processing', 'needs_reconciliation'),
        ('storing', 'succeeded'), ('storing', 'needs_reconciliation'),
        ('needs_reconciliation', 'processing'), ('needs_reconciliation', 'storing'),
        ('needs_reconciliation', 'failed'), ('needs_reconciliation', 'canceled'))
$$;

create function public.generations_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.owner_id <> old.owner_id or new.reserved_credits <> old.reserved_credits
     or new.estimated_cost_minor <> old.estimated_cost_minor or new.idempotency_key <> old.idempotency_key then
    raise exception 'immutable generation fields' using errcode = '42501';
  end if;
  if new.status <> old.status or old.status in ('succeeded', 'failed', 'canceled') then
    if old.status in ('succeeded', 'failed', 'canceled') and (new.status <> old.status or new.output_asset_id is distinct from old.output_asset_id) then
      raise exception 'terminal generation is immutable' using errcode = '42501';
    end if;
    if new.status <> old.status and not public.generation_transition_allowed(old.status, new.status) then
      raise exception 'invalid generation transition % -> %', old.status, new.status using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger generations_guard before update on public.generations
for each row execute function public.generations_guard();

create function public.generations_owner_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.projects where id = new.project_id and owner_id = new.owner_id) then
    raise exception 'generation project owner mismatch' using errcode = '42501';
  end if;
  if not exists (select 1 from public.assets where id = new.image_asset_id and owner_id = new.owner_id) then
    raise exception 'generation image owner mismatch' using errcode = '42501';
  end if;
  if new.audio_asset_id is not null and not exists (select 1 from public.assets where id = new.audio_asset_id and owner_id = new.owner_id) then
    raise exception 'generation audio owner mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger generations_owner_guard before insert or update of project_id, image_asset_id, audio_asset_id on public.generations
for each row execute function public.generations_owner_guard();

-- New auth user -> profile + empty credit account.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  insert into public.credit_accounts (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.generations enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_packs enable row level security;
alter table public.purchases enable row level security;
alter table public.webhook_events enable row level security;
alter table public.job_outbox enable row level security;
alter table public.audit_logs enable row level security;
alter table public.budget_days enable row level security;
alter table public.rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles, public.user_roles, public.projects, public.assets, public.generations,
  public.credit_accounts, public.credit_ledger, public.credit_packs, public.purchases to authenticated;
grant update (display_name, locale) on public.profiles to authenticated;
grant insert (owner_id, title) on public.projects to authenticated;
grant update (title, deleted_at) on public.projects to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy user_roles_select_own on public.user_roles for select to authenticated using (user_id = (select auth.uid()));

create policy projects_select_own on public.projects for select to authenticated using (owner_id = (select auth.uid()));
create policy projects_insert_own on public.projects for insert to authenticated with check (owner_id = (select auth.uid()));
create policy projects_update_own on public.projects for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy assets_select_own on public.assets for select to authenticated using (owner_id = (select auth.uid()));
create policy generations_select_own on public.generations for select to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null);
create policy credit_accounts_select_own on public.credit_accounts for select to authenticated using (user_id = (select auth.uid()));
create policy credit_ledger_select_own on public.credit_ledger for select to authenticated using (user_id = (select auth.uid()));
create policy credit_packs_select_active on public.credit_packs for select to authenticated using (active);
create policy purchases_select_own on public.purchases for select to authenticated using (user_id = (select auth.uid()));
-- webhook_events, job_outbox, audit_logs, budget_days, rate_limits: no policy = no client access.

-- ---------------------------------------------------------------------------
-- Transactional functions (service_role only)
-- ---------------------------------------------------------------------------

create function public.ensure_profile(p_user_id uuid, p_email text, p_bonus integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (p_user_id, p_email) on conflict (id) do nothing;
  insert into public.credit_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  if p_bonus > 0 then
    perform public.apply_ledger(p_user_id, null, 'signup_bonus', p_bonus, 0, 'signup_bonus:' || p_user_id, '{}'::jsonb);
  end if;
end $$;

-- Applies one ledger entry exactly once. Returns false if already applied.
create function public.apply_ledger(
  p_user_id uuid, p_generation_id uuid, p_event text, p_available integer, p_reserved integer,
  p_key text, p_metadata jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_inserted uuid;
begin
  insert into public.credit_ledger (user_id, generation_id, event_type, available_delta, reserved_delta, idempotency_key, metadata)
  values (p_user_id, p_generation_id, p_event, p_available, p_reserved, p_key, coalesce(p_metadata, '{}'::jsonb))
  on conflict (idempotency_key) do nothing
  returning id into v_inserted;
  if v_inserted is null then
    return false;
  end if;
  insert into public.credit_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  -- check constraints reject any negative balance and abort the transaction
  update public.credit_accounts
     set available_credits = available_credits + p_available,
         reserved_credits = reserved_credits + p_reserved,
         updated_at = now()
   where user_id = p_user_id;
  return true;
end $$;

create function public.reserve_generation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := (p ->> 'owner_id')::uuid;
  v_credits integer := (p ->> 'credits')::integer;
  v_cost bigint := (p ->> 'estimated_cost_minor')::bigint;
  v_day date := (p ->> 'budget_day')::date;
  v_budget_limit bigint := nullif(p ->> 'daily_budget_minor', '')::bigint;
  v_existing public.generations;
  v_account public.credit_accounts;
  v_budget public.budget_days;
  v_active integer;
  v_gen public.generations;
begin
  if v_credits < 0 or v_cost < 0 then
    raise exception 'negative amounts' using errcode = '22023';
  end if;

  -- Serialize all reservations of this user.
  insert into public.credit_accounts (user_id) values (v_owner) on conflict (user_id) do nothing;
  select * into v_account from public.credit_accounts where user_id = v_owner for update;

  select * into v_existing from public.generations where owner_id = v_owner and idempotency_key = p ->> 'idempotency_key';
  if found then
    return jsonb_build_object('ok', true, 'created', false, 'generation_id', v_existing.id);
  end if;

  if not exists (select 1 from public.projects where id = (p ->> 'project_id')::uuid and owner_id = v_owner and deleted_at is null)
     or not exists (select 1 from public.assets where id = (p ->> 'image_asset_id')::uuid and owner_id = v_owner and status = 'ready' and kind = 'image')
     or (p ->> 'audio_asset_id' is not null and not exists (
           select 1 from public.assets where id = (p ->> 'audio_asset_id')::uuid and owner_id = v_owner and status = 'ready' and kind = 'audio')) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_assets');
  end if;

  select count(*) into v_active from public.generations
   where owner_id = v_owner and status in ('queued', 'preparing_audio', 'submitting', 'processing', 'storing', 'needs_reconciliation');
  if v_active >= (p ->> 'max_concurrent_jobs')::integer then
    return jsonb_build_object('ok', false, 'reason', 'too_many_active_jobs');
  end if;

  if v_account.available_credits < v_credits then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_credits');
  end if;

  -- Global daily provider budget, reserved atomically across all users.
  insert into public.budget_days (day) values (v_day) on conflict (day) do nothing;
  select * into v_budget from public.budget_days where day = v_day for update;
  if v_budget_limit is not null and v_budget.reserved_minor + v_budget.spent_minor + v_cost > v_budget_limit then
    return jsonb_build_object('ok', false, 'reason', 'daily_budget_exceeded');
  end if;

  insert into public.generations (
    owner_id, project_id, provider, model_id, status, parameters, image_asset_id, audio_asset_id,
    reserved_credits, price_version, estimated_cost_minor, currency, idempotency_key, budget_day, next_check_at)
  values (
    v_owner, (p ->> 'project_id')::uuid, p ->> 'provider', p ->> 'model_id', 'queued', p -> 'parameters',
    (p ->> 'image_asset_id')::uuid, nullif(p ->> 'audio_asset_id', '')::uuid,
    v_credits, p ->> 'price_version', v_cost, p ->> 'currency', p ->> 'idempotency_key', v_day, now())
  returning * into v_gen;

  perform public.apply_ledger(v_owner, v_gen.id, 'reserve', -v_credits, v_credits, 'reserve:' || v_gen.id, '{}'::jsonb);
  update public.budget_days set reserved_minor = reserved_minor + v_cost where day = v_day;
  insert into public.job_outbox (generation_id) values (v_gen.id);
  update public.projects set updated_at = now() where id = v_gen.project_id;

  return jsonb_build_object('ok', true, 'created', true, 'generation_id', v_gen.id);
end $$;

create function public.transition_generation(p_id uuid, p_from text[], p_to text, p_patch jsonb, p_expected_attempts integer default null)
returns setof public.generations
language plpgsql security definer set search_path = public as $$
begin
  if p_to in ('succeeded', 'failed', 'canceled') then
    raise exception 'use complete_generation / fail_generation for terminal states' using errcode = '22023';
  end if;
  return query
  update public.generations g set
    status = p_to,
    provider_job_id = case when p_patch ? 'provider_job_id' then p_patch ->> 'provider_job_id' else g.provider_job_id end,
    error_code = case when p_patch ? 'error_code' then p_patch ->> 'error_code' else g.error_code end,
    error_message = case when p_patch ? 'error_message' then p_patch ->> 'error_message' else g.error_message end,
    next_check_at = case when p_patch ? 'next_check_at' then (p_patch ->> 'next_check_at')::timestamptz else g.next_check_at end,
    attempts = case when p_patch ? 'attempts' then (p_patch ->> 'attempts')::integer else g.attempts end,
    audio_asset_id = case when p_patch ? 'audio_asset_id' then (p_patch ->> 'audio_asset_id')::uuid else g.audio_asset_id end,
    parameters = case when p_patch ? 'parameters' then p_patch -> 'parameters' else g.parameters end
  where g.id = p_id and g.status = any (p_from)
    and (p_expected_attempts is null or g.attempts = p_expected_attempts)
  returning g.*;
end $$;

create function public.complete_generation(p_id uuid, p_output_asset_id uuid, p_actual_cost_minor bigint)
returns public.generations
language plpgsql security definer set search_path = public as $$
declare
  v_gen public.generations;
begin
  select * into v_gen from public.generations where id = p_id for update;
  if not found then raise exception 'generation not found' using errcode = 'P0002'; end if;
  if v_gen.status = 'succeeded' then return v_gen; end if;
  if v_gen.status <> 'storing' then
    raise exception 'invalid transition % -> succeeded', v_gen.status using errcode = '22023';
  end if;
  perform public.apply_ledger(v_gen.owner_id, v_gen.id, 'consume', 0, -v_gen.reserved_credits, 'consume:' || v_gen.id, '{}'::jsonb);
  insert into public.budget_days (day) values (v_gen.budget_day) on conflict (day) do nothing;
  update public.budget_days
     set reserved_minor = greatest(0, reserved_minor - v_gen.estimated_cost_minor),
         spent_minor = spent_minor + coalesce(p_actual_cost_minor, v_gen.estimated_cost_minor)
   where day = v_gen.budget_day;
  update public.generations
     set status = 'succeeded', output_asset_id = p_output_asset_id, actual_cost_minor = p_actual_cost_minor, next_check_at = null
   where id = p_id
  returning * into v_gen;
  return v_gen;
end $$;

create function public.fail_generation(
  p_id uuid, p_status text, p_error_code text, p_error_message text, p_provider_cost_minor bigint, p_actor uuid
) returns public.generations
language plpgsql security definer set search_path = public as $$
declare
  v_gen public.generations;
begin
  if p_status not in ('failed', 'canceled') then
    raise exception 'invalid terminal status' using errcode = '22023';
  end if;
  select * into v_gen from public.generations where id = p_id for update;
  if not found then raise exception 'generation not found' using errcode = 'P0002'; end if;
  if v_gen.status in ('succeeded', 'failed', 'canceled') then return v_gen; end if;
  perform public.apply_ledger(v_gen.owner_id, v_gen.id, 'release', v_gen.reserved_credits, -v_gen.reserved_credits,
    'release:' || v_gen.id, jsonb_build_object('error_code', p_error_code));
  insert into public.budget_days (day) values (v_gen.budget_day) on conflict (day) do nothing;
  update public.budget_days
     set reserved_minor = greatest(0, reserved_minor - v_gen.estimated_cost_minor),
         spent_minor = spent_minor + coalesce(p_provider_cost_minor, 0)
   where day = v_gen.budget_day;
  update public.generations
     set status = p_status, error_code = p_error_code, error_message = p_error_message,
         actual_cost_minor = p_provider_cost_minor, next_check_at = null
   where id = p_id
  returning * into v_gen;
  if p_actor is not null then
    insert into public.audit_logs (actor_id, action, target_type, target_id, sanitized_metadata)
    values (p_actor, 'generation.resolve_' || p_status, 'generation', p_id::text, jsonb_build_object('error_code', p_error_code));
  end if;
  return v_gen;
end $$;

create function public.claim_outbox(p_now timestamptz, p_limit integer) returns setof public.job_outbox
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.job_outbox o
     set attempts = o.attempts + 1, next_attempt_at = p_now + interval '60 seconds'
   where o.id in (
     select id from public.job_outbox
      where dispatch_status <> 'dispatched' and next_attempt_at <= p_now
      order by next_attempt_at
      limit p_limit
      for update skip locked)
  returning o.*;
end $$;

create function public.admin_adjust_credits(p_actor uuid, p_user uuid, p_delta integer, p_reason text, p_key text)
returns public.credit_accounts
language plpgsql security definer set search_path = public as $$
declare
  v_account public.credit_accounts;
begin
  if char_length(coalesce(p_reason, '')) < 3 then
    raise exception 'reason required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_roles where user_id = p_actor and role = 'admin') then
    raise exception 'actor is not admin' using errcode = '42501';
  end if;
  select * into v_account from public.credit_accounts where user_id = p_user for update;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  if public.apply_ledger(p_user, null, 'admin_adjustment', p_delta, 0, p_key,
       jsonb_build_object('reason', p_reason, 'actor_id', p_actor)) then
    insert into public.audit_logs (actor_id, action, target_type, target_id, sanitized_metadata)
    values (p_actor, 'credits.adjust', 'user', p_user::text, jsonb_build_object('delta', p_delta, 'reason', p_reason));
  end if;
  select * into v_account from public.credit_accounts where user_id = p_user;
  return v_account;
end $$;

create function public.fulfill_purchase(p_purchase_id uuid, p_session_id text, p_amount_minor bigint, p_currency text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_purchase public.purchases;
  v_applied boolean;
begin
  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then raise exception 'purchase not found' using errcode = 'P0002'; end if;
  if v_purchase.stripe_session_id is not null and v_purchase.stripe_session_id <> p_session_id then
    raise exception 'session mismatch' using errcode = '22023';
  end if;
  if v_purchase.amount_minor <> p_amount_minor or upper(v_purchase.currency) <> upper(p_currency) then
    raise exception 'amount mismatch' using errcode = '22023';
  end if;
  if v_purchase.credited_at is not null then return false; end if;
  v_applied := public.apply_ledger(v_purchase.user_id, null, 'purchase', v_purchase.credits_snapshot, 0,
    'purchase:' || v_purchase.id, jsonb_build_object('pack_id', v_purchase.pack_id));
  update public.purchases set stripe_session_id = p_session_id, payment_status = 'paid', credited_at = now()
   where id = p_purchase_id;
  return v_applied;
end $$;

create function public.reverse_purchase(p_purchase_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_purchase public.purchases;
  v_account public.credit_accounts;
  v_existing public.credit_ledger;
  v_reversed integer;
begin
  if p_status not in ('refunded', 'disputed') then raise exception 'invalid status' using errcode = '22023'; end if;
  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then raise exception 'purchase not found' using errcode = 'P0002'; end if;
  update public.purchases set payment_status = p_status where id = p_purchase_id;
  if v_purchase.credited_at is null then
    return jsonb_build_object('reversed', 0, 'uncovered', 0);
  end if;
  select * into v_existing from public.credit_ledger where idempotency_key = 'reversal:' || p_purchase_id;
  if found then
    return jsonb_build_object('reversed', -v_existing.available_delta, 'uncovered', coalesce((v_existing.metadata ->> 'uncovered')::integer, 0));
  end if;
  select * into v_account from public.credit_accounts where user_id = v_purchase.user_id for update;
  v_reversed := least(v_account.available_credits, v_purchase.credits_snapshot);
  perform public.apply_ledger(v_purchase.user_id, null, 'refund_reversal', -v_reversed, 0, 'reversal:' || p_purchase_id,
    jsonb_build_object('status', p_status, 'uncovered', v_purchase.credits_snapshot - v_reversed));
  insert into public.audit_logs (actor_id, action, target_type, target_id, sanitized_metadata)
  values (null, 'purchase.' || p_status, 'purchase', p_purchase_id::text,
    jsonb_build_object('reversed', v_reversed, 'uncovered', v_purchase.credits_snapshot - v_reversed));
  return jsonb_build_object('reversed', v_reversed, 'uncovered', v_purchase.credits_snapshot - v_reversed);
end $$;

create function public.record_webhook_event(p_provider text, p_event_id text, p_payload_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_inserted text;
begin
  insert into public.webhook_events (provider, event_id, payload_hash) values (p_provider, p_event_id, p_payload_hash)
  on conflict (provider, event_id) do nothing
  returning event_id into v_inserted;
  return v_inserted is not null;
end $$;

create function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  -- opportunistic cleanup of old windows
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_count <= p_max;
end $$;

create function public.admin_stats() returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.generations group by status) s), '{}'::jsonb),
    'estimated_cost_minor', coalesce((select sum(estimated_cost_minor) from public.generations), 0),
    'actual_cost_minor', coalesce((select sum(actual_cost_minor) from public.generations), 0),
    'failures_24h', (select count(*) from public.generations where status = 'failed' and updated_at > now() - interval '24 hours'),
    'budget_today', (select to_jsonb(b) from public.budget_days b where day = (now() at time zone 'utc')::date)
  )
$$;

create function public.delete_user_data(p_user uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_paths text[];
begin
  if exists (select 1 from public.generations where owner_id = p_user
             and status in ('queued', 'preparing_audio', 'submitting', 'processing', 'storing', 'needs_reconciliation')) then
    raise exception 'generation active' using errcode = '55006';
  end if;
  select coalesce(array_agg(storage_path), '{}') into v_paths from public.assets where owner_id = p_user;
  insert into public.audit_logs (actor_id, action, target_type, target_id) values (p_user, 'account.delete', 'user', p_user::text);
  -- Deleting the auth user cascades to profiles, projects, assets, generations,
  -- credit rows and purchases. Billing exports needed for accounting must be
  -- taken before (see docs/privacy-and-launch.md).
  return v_paths;
end $$;

create function public.grant_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_roles (user_id, role) values (p_user, 'admin') on conflict do nothing;
  insert into public.audit_logs (actor_id, action, target_type, target_id, sanitized_metadata)
  values (null, 'role.grant_admin', 'user', p_user::text, '{"via":"cli"}'::jsonb);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'ensure_profile(uuid,text,integer)',
    'apply_ledger(uuid,uuid,text,integer,integer,text,jsonb)',
    'reserve_generation(jsonb)',
    'transition_generation(uuid,text[],text,jsonb,integer)',
    'complete_generation(uuid,uuid,bigint)',
    'fail_generation(uuid,text,text,text,bigint,uuid)',
    'claim_outbox(timestamptz,integer)',
    'admin_adjust_credits(uuid,uuid,integer,text,text)',
    'fulfill_purchase(uuid,text,bigint,text)',
    'reverse_purchase(uuid,text)',
    'record_webhook_event(text,text,text)',
    'hit_rate_limit(text,integer,integer)',
    'admin_stats()',
    'delete_user_data(uuid)',
    'grant_admin(uuid)',
    'handle_new_user()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, objects under "<user_id>/..."
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 26214400)
on conflict (id) do update set public = false;

create policy media_read_own on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No insert/update/delete policies: uploads use server-issued signed upload
-- URLs and every other write goes through the service role.
