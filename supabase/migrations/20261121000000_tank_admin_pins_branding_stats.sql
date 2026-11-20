-- =====================================================================
-- WonderFish: per-tank admin PINs, WonderLab master PIN, shop branding,
-- scan statistics (survive the 2-day fish cleanup) and PIN-protected
-- admin RPCs used by admin.html / aquarium.html.
--
-- Roles:
--   * Tank PIN  (shop / party host) -> start event, branding, report,
--                                      reset tank, delete fish, change PIN
--   * Master PIN (WonderLab owner)  -> everything above for ANY tank,
--                                      plus change plan / restart timer,
--                                      list all tanks, change master PIN
--
-- The master PIN hash is seeded OUTSIDE this file (never commit PINs):
--   insert into public.wonderfish_owner_settings (id, master_pin_hash)
--   values (1, extensions.crypt('YOUR-PIN', extensions.gen_salt('bf')))
--   on conflict (id) do update set master_pin_hash = excluded.master_pin_hash;
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Branding columns (public, shown on TV + coloring sheets)
-- ---------------------------------------------------------------------
alter table public.aquarium_tanks
  add column if not exists brand_name  text not null default '',
  add column if not exists brand_logo  text not null default '',   -- small data:image/... URL
  add column if not exists brand_color text not null default '';

-- Anonymous visitors may still create a tank row (old cached pages do an
-- upsert), but ONLY with the free defaults. Upgrades go through the
-- master-PIN RPC below.
drop policy if exists "Public create tanks" on public.aquarium_tanks;
create policy "Public create tanks" on public.aquarium_tanks
  for insert to anon, authenticated
  with check (
    char_length(room_code) between 2 and 32
    and room_code ~ '^[A-Za-z0-9_-]+$'
    and char_length(title) <= 80
    and plan_code = 'free'
    and scan_limit is not distinct from 6
    and fish_limit = 6
    and duration_minutes is not distinct from 30
    and event_started_at is null
    and event_ends_at is null
    and brand_name = ''
    and brand_logo = ''
    and brand_color = ''
  );

-- ---------------------------------------------------------------------
-- 2. Private tables (RLS on, no policies -> invisible to the browser)
-- ---------------------------------------------------------------------
create table if not exists public.aquarium_tank_secrets (
  room_code       text primary key references public.aquarium_tanks(room_code) on delete cascade,
  pin_hash        text,                         -- null = legacy tank, default PIN 1234
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);
alter table public.aquarium_tank_secrets enable row level security;
revoke all on public.aquarium_tank_secrets from public, anon, authenticated;

create table if not exists public.wonderfish_owner_settings (
  id              smallint primary key default 1 check (id = 1),
  master_pin_hash text not null,
  failed_attempts integer not null default 0,
  last_failed_at  timestamptz,
  locked_until    timestamptz
);
alter table public.wonderfish_owner_settings enable row level security;
revoke all on public.wonderfish_owner_settings from public, anon, authenticated;

-- Hourly scan counters per tank + species. NOT deleted by cleanup-old-fish.
create table if not exists public.aquarium_scan_stats (
  room_code   text not null,
  hour_bucket timestamptz not null,
  species     text not null,
  scans       integer not null default 0,
  primary key (room_code, hour_bucket, species)
);
alter table public.aquarium_scan_stats enable row level security;
revoke all on public.aquarium_scan_stats from public, anon, authenticated;

create or replace function public._wf_count_scan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.aquarium_scan_stats (room_code, hour_bucket, species, scans)
  values (new.room_code, date_trunc('hour', coalesce(new.created_at, now())), coalesce(new.species, 'unknown'), 1)
  on conflict (room_code, hour_bucket, species)
  do update set scans = public.aquarium_scan_stats.scans + 1;
  return new;
end;
$$;
revoke all on function public._wf_count_scan() from public, anon, authenticated;

drop trigger if exists wf_count_scan on public.aquarium_fishes;
create trigger wf_count_scan
  after insert on public.aquarium_fishes
  for each row execute function public._wf_count_scan();

-- ---------------------------------------------------------------------
-- 3. Helpers (internal only)
-- ---------------------------------------------------------------------
create or replace function public._wf_room(p text)
returns text
language sql
immutable
as $$ select regexp_replace(upper(btrim(coalesce(p, ''))), '[^A-Z0-9_-]', '', 'g') $$;

-- Every wrong PIN also counts against the master PIN window
-- (25 wrong PINs within 15 min -> master PIN locked for 15 min).
create or replace function public._wf_note_master_failure()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.wonderfish_owner_settings
    set failed_attempts = case when last_failed_at is null or last_failed_at < now() - interval '15 minutes'
                               then 1 else failed_attempts + 1 end,
        last_failed_at = now()
    where id = 1;
  update public.wonderfish_owner_settings
    set locked_until = now() + interval '15 minutes', failed_attempts = 0
    where id = 1 and failed_attempts >= 25;
end;
$$;
revoke all on function public._wf_note_master_failure() from public, anon, authenticated;

-- Returns 'master' | 'owner' | 'bad' | 'locked' | 'no_tank'.
-- Never raises, so failed-attempt counters are committed.
create or replace function public._wf_check_pin(p_room text, p_pin text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room text := public._wf_room(p_room);
  v_pin  text := btrim(coalesce(p_pin, ''));
  m public.wonderfish_owner_settings%rowtype;
  s public.aquarium_tank_secrets%rowtype;
begin
  if v_pin = '' or char_length(v_pin) > 32 then
    return 'bad';
  end if;

  -- Master PIN (global failure window: 25 wrong PINs / 15 min -> 15 min lock)
  select * into m from public.wonderfish_owner_settings where id = 1 for update;
  if found and (m.locked_until is null or m.locked_until <= now()) then
    if m.master_pin_hash = crypt(v_pin, m.master_pin_hash) then
      update public.wonderfish_owner_settings
        set failed_attempts = 0, last_failed_at = null, locked_until = null
        where id = 1;
      return 'master';
    end if;
  end if;

  if v_room = '' or not exists (select 1 from public.aquarium_tanks where room_code = v_room) then
    perform public._wf_note_master_failure();
    return 'no_tank';
  end if;

  insert into public.aquarium_tank_secrets (room_code) values (v_room)
    on conflict (room_code) do nothing;
  select * into s from public.aquarium_tank_secrets where room_code = v_room for update;

  if s.locked_until is not null and s.locked_until > now() then
    return 'locked';
  end if;

  if (s.pin_hash is null and v_pin = '1234')
     or (s.pin_hash is not null and s.pin_hash = crypt(v_pin, s.pin_hash)) then
    update public.aquarium_tank_secrets
      set failed_attempts = 0, locked_until = null
      where room_code = v_room;
    return 'owner';
  end if;

  -- Wrong PIN: per-tank lock after 8 tries (10 min)
  update public.aquarium_tank_secrets
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 8 then now() + interval '10 minutes' else null end
    where room_code = v_room;
  update public.aquarium_tank_secrets
    set failed_attempts = 0
    where room_code = v_room and locked_until is not null;

  perform public._wf_note_master_failure();
  return 'bad';
end;
$$;
revoke all on function public._wf_check_pin(text, text) from public, anon, authenticated;

create or replace function public._wf_pin_error(p_result text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'ok', false,
    'error', case p_result
               when 'locked'  then 'PIN_LOCKED'
               when 'no_tank' then 'TANK_NOT_FOUND'
               else 'BAD_PIN' end
  )
$$;

-- Public tank status (no secrets). Scans are counted since the event started.
create or replace function public._wf_tank_json(p_room text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.aquarium_tanks%rowtype;
  v_used integer;
  v_has_pin boolean;
begin
  select * into t from public.aquarium_tanks where room_code = public._wf_room(p_room);
  if not found then
    return null;
  end if;
  select count(*)::integer into v_used
    from public.aquarium_fishes
    where room_code = t.room_code
      and (t.event_started_at is null or created_at >= t.event_started_at);
  select (pin_hash is not null) into v_has_pin from public.aquarium_tank_secrets where room_code = t.room_code;
  return jsonb_build_object(
    'room_code', t.room_code,
    'title', t.title,
    'plan_code', t.plan_code,
    'scan_limit', t.scan_limit,
    'duration_minutes', t.duration_minutes,
    'event_started_at', t.event_started_at,
    'event_ends_at', t.event_ends_at,
    'scans_used', v_used,
    'brand_name', t.brand_name,
    'brand_logo', t.brand_logo,
    'brand_color', t.brand_color,
    'state', case
               when t.plan_code = 'legacy' then 'live'
               when t.event_started_at is null then 'not_started'
               when t.event_ends_at is not null and t.event_ends_at <= clock_timestamp() then 'ended'
               when t.scan_limit is not null and v_used >= t.scan_limit then 'full'
               else 'live' end,
    'custom_pin', coalesce(v_has_pin, false),
    'server_now', clock_timestamp()
  );
end;
$$;
revoke all on function public._wf_tank_json(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Lock down the older plan RPCs (they were callable without a PIN)
-- ---------------------------------------------------------------------
revoke execute on function public.ensure_aquarium_tank(text, text, text) from public, anon, authenticated;
revoke execute on function public.start_aquarium_event(text) from public, anon, authenticated;
drop function if exists public.reset_aquarium(text);

-- Venue = always on, unlimited scans
create or replace function public._wf_apply_plan(p_room text, p_plan text, p_restart boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dur integer; v_lim integer; v_fish integer;
begin
  case p_plan
    when 'free'   then v_dur := 30;   v_lim := 6;    v_fish := 6;
    when 'play'   then v_dur := 180;  v_lim := 25;   v_fish := 25;
    when 'day'    then v_dur := 1440; v_lim := 100;  v_fish := 100;
    when 'venue'  then v_dur := null; v_lim := null; v_fish := 100;
    when 'legacy' then v_dur := null; v_lim := null; v_fish := 100;
    else raise exception 'INVALID_PLAN';
  end case;
  update public.aquarium_tanks
    set plan_code = p_plan,
        duration_minutes = v_dur,
        scan_limit = v_lim,
        fish_limit = v_fish,
        event_started_at = case when p_restart then null else event_started_at end,
        event_ends_at = case
                          when p_restart then null
                          when event_started_at is null or v_dur is null then null
                          else event_started_at + v_dur * interval '1 minute' end
    where room_code = p_room;
end;
$$;
revoke all on function public._wf_apply_plan(text, text, boolean) from public, anon, authenticated;

-- Scan quota counts fish since the event started (so restarts / upgrades work)
create or replace function public.guard_aquarium_fish_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room text; v_tank public.aquarium_tanks%rowtype; v_fish_count integer;
begin
  v_room := public._wf_room(coalesce(new.room_code, 'WONDER-REEF'));
  if char_length(v_room) < 2 or char_length(v_room) > 28 then
    raise exception 'INVALID_ROOM_CODE: Please provide a valid Tank Code.';
  end if;
  new.room_code := v_room;
  select * into v_tank from public.aquarium_tanks where room_code = v_room for update;
  if not found then
    perform public.ensure_aquarium_tank(v_room, null, 'free');
    select * into v_tank from public.aquarium_tanks where room_code = v_room for update;
  end if;
  if v_tank.plan_code <> 'legacy' and v_tank.event_started_at is null then
    raise exception 'TANK_NOT_STARTED: Ask the host to press Start Event before sending fish.';
  end if;
  if v_tank.event_ends_at is not null and v_tank.event_ends_at <= clock_timestamp() then
    raise exception 'TANK_EVENT_ENDED: This live tank session has ended.';
  end if;
  if v_tank.scan_limit is not null then
    select count(*)::integer into v_fish_count
      from public.aquarium_fishes
      where room_code = v_room
        and (v_tank.event_started_at is null or created_at >= v_tank.event_started_at);
    if v_fish_count >= v_tank.scan_limit then
      raise exception 'FISH_LIMIT_REACHED: This Tank has reached its % fish scan limit.', v_tank.scan_limit;
    end if;
  end if;
  return new;
end;
$$;

-- add_aquarium_fish duplicated the checks; the trigger above now does them.
create or replace function public.add_aquarium_fish(target_room text, fish_name text, fish_species text, fish_texture_url text)
returns public.aquarium_fishes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text; v_species text; v_fish public.aquarium_fishes%rowtype;
begin
  v_name := left(coalesce(nullif(btrim(fish_name), ''), 'Explorer'), 40);
  v_species := lower(btrim(coalesce(fish_species, '')));
  if char_length(v_species) < 1 or char_length(v_species) > 32 or v_species !~ '^[a-z0-9_-]+$' then
    raise exception 'INVALID_SPECIES: Please choose a supported sea creature.';
  end if;
  if coalesce(btrim(fish_texture_url), '') = '' then
    raise exception 'INVALID_TEXTURE_URL: A scanned fish texture is required.';
  end if;
  insert into public.aquarium_fishes(name, species, texture_url, room_code)
    values (v_name, v_species, fish_texture_url, target_room)
    returning * into v_fish;
  return v_fish;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Public RPCs
-- ---------------------------------------------------------------------
create or replace function public.get_tank_status(target_room text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$ select public._wf_tank_json(target_room) $$;

-- Create a NEW tank with its own PIN (free plan). Refuses existing codes.
create or replace function public.create_tank_with_pin(target_room text, target_title text, new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room text := public._wf_room(target_room);
  v_pin text := btrim(coalesce(new_pin, ''));
begin
  if char_length(v_room) < 2 or char_length(v_room) > 28 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ROOM_CODE');
  end if;
  if v_pin !~ '^[0-9]{4,12}$' or v_pin = '1234' then
    return jsonb_build_object('ok', false, 'error', 'WEAK_PIN');
  end if;
  if exists (select 1 from public.aquarium_tanks where room_code = v_room) then
    return jsonb_build_object('ok', false, 'error', 'TANK_EXISTS');
  end if;
  insert into public.aquarium_tanks (room_code, title)
    values (v_room, coalesce(nullif(left(btrim(coalesce(target_title, '')), 80), ''), 'Tank ' || v_room));
  insert into public.aquarium_tank_secrets (room_code, pin_hash)
    values (v_room, crypt(v_pin, gen_salt('bf')));
  return jsonb_build_object('ok', true, 'tank', public._wf_tank_json(v_room));
end;
$$;

create or replace function public.admin_login(target_room text, admin_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r text := public._wf_check_pin(target_room, admin_pin);
begin
  if r not in ('master', 'owner') then
    return public._wf_pin_error(r);
  end if;
  return jsonb_build_object(
    'ok', true,
    'role', r,
    'default_pin', (r = 'owner' and btrim(admin_pin) = '1234'),
    'tank', public._wf_tank_json(target_room)
  );
end;
$$;

create or replace function public.admin_start_event(target_room text, admin_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public._wf_check_pin(target_room, admin_pin);
  v_room text := public._wf_room(target_room);
  t public.aquarium_tanks%rowtype;
begin
  if r not in ('master', 'owner') then
    return public._wf_pin_error(r);
  end if;
  select * into t from public.aquarium_tanks where room_code = v_room for update;
  if t.event_started_at is not null then
    if t.event_ends_at is not null and t.event_ends_at <= clock_timestamp() then
      if r <> 'master' then
        return jsonb_build_object('ok', false, 'error', 'EVENT_ENDED');
      end if;
    else
      return jsonb_build_object('ok', true, 'tank', public._wf_tank_json(v_room));
    end if;
  end if;
  update public.aquarium_tanks
    set event_started_at = clock_timestamp(),
        event_ends_at = case when duration_minutes is null then null
                             else clock_timestamp() + duration_minutes * interval '1 minute' end
    where room_code = v_room;
  return jsonb_build_object('ok', true, 'tank', public._wf_tank_json(v_room));
end;
$$;

create or replace function public.admin_change_pin(target_room text, admin_pin text, new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r text := public._wf_check_pin(target_room, admin_pin);
  v_pin text := btrim(coalesce(new_pin, ''));
begin
  if r not in ('master', 'owner') then
    return public._wf_pin_error(r);
  end if;
  if v_pin !~ '^[0-9]{4,12}$' or v_pin = '1234' then
    return jsonb_build_object('ok', false, 'error', 'WEAK_PIN');
  end if;
  insert into public.aquarium_tank_secrets (room_code, pin_hash, updated_at)
    values (public._wf_room(target_room), crypt(v_pin, gen_salt('bf')), now())
    on conflict (room_code) do update
      set pin_hash = excluded.pin_hash, updated_at = now(), failed_attempts = 0, locked_until = null;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_set_branding(
  target_room text, admin_pin text, new_title text, new_brand_name text, new_brand_logo text, new_brand_color text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public._wf_check_pin(target_room, admin_pin);
  v_logo text := coalesce(new_brand_logo, '');
  v_color text := btrim(coalesce(new_brand_color, ''));
begin
  if r not in ('master', 'owner') then
    return public._wf_pin_error(r);
  end if;
  if v_logo <> '' and (char_length(v_logo) > 400000 or v_logo !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$') then
    return jsonb_build_object('ok', false, 'error', 'BAD_LOGO');
  end if;
  if v_color <> '' and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    v_color := '';
  end if;
  update public.aquarium_tanks
    set title = coalesce(nullif(left(btrim(coalesce(new_title, '')), 80), ''), title),
        brand_name = left(btrim(coalesce(new_brand_name, '')), 60),
        brand_logo = v_logo,
        brand_color = v_color
    where room_code = public._wf_room(target_room);
  return jsonb_build_object('ok', true, 'tank', public._wf_tank_json(target_room));
end;
$$;

create or replace function public.admin_reset_tank(target_room text, admin_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r text := public._wf_check_pin(target_room, admin_pin); n integer;
begin
  if r not in ('master', 'owner') then
    return public._wf_pin_error(r);
  end if;
  delete from public.aquarium_fishes where room_code = public._wf_room(target_room);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end;
$$;

create or replace function public.admin_delete_fish(target_room text, admin_pin text, target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r text := public._wf_check_pin(target_room, admin_pin);
begin
  if r not in ('master', 'owner') then
    return public._wf_pin_error(r);
  end if;
  delete from public.aquarium_fishes where id = target_id and room_code = public._wf_room(target_room);
  return jsonb_build_object('ok', true, 'deleted', found);
end;
$$;

-- Scan report for shops (Sri Lanka time).
create or replace function public.admin_tank_report(target_room text, admin_pin text, days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public._wf_check_pin(target_room, admin_pin);
  v_room text := public._wf_room(target_room);
  v_days integer := greatest(1, least(coalesce(days, 30), 366));
  v_tz text := 'Asia/Colombo';
  v_from timestamptz;
begin
  if r not in ('master', 'owner') then
    return public._wf_pin_error(r);
  end if;
  v_from := (((now() at time zone v_tz)::date - (v_days - 1))::timestamp) at time zone v_tz;
  return jsonb_build_object(
    'ok', true,
    'tank', public._wf_tank_json(v_room),
    'days', v_days,
    'timezone', v_tz,
    'total_all_time', (select coalesce(sum(scans), 0) from aquarium_scan_stats where room_code = v_room),
    'total_range', (select coalesce(sum(scans), 0) from aquarium_scan_stats where room_code = v_room and hour_bucket >= v_from),
    'today', (select coalesce(sum(scans), 0) from aquarium_scan_stats where room_code = v_room
                and hour_bucket >= (((now() at time zone v_tz)::date)::timestamp) at time zone v_tz),
    'first_scan', (select min(hour_bucket) from aquarium_scan_stats where room_code = v_room),
    'last_scan', (select max(hour_bucket) from aquarium_scan_stats where room_code = v_room),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day::date, 'scans', coalesce(s.scans, 0)) order by d.day)
      from generate_series((now() at time zone v_tz)::date - (v_days - 1), (now() at time zone v_tz)::date, interval '1 day') as d(day)
      left join (
        select (hour_bucket at time zone v_tz)::date as day, sum(scans)::integer as scans
        from aquarium_scan_stats where room_code = v_room and hour_bucket >= v_from
        group by 1
      ) s on s.day = d.day::date
    ), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'scans', coalesce(s.scans, 0)) order by h.hour)
      from generate_series(0, 23) as h(hour)
      left join (
        select extract(hour from hour_bucket at time zone v_tz)::integer as hour, sum(scans)::integer as scans
        from aquarium_scan_stats where room_code = v_room and hour_bucket >= v_from
        group by 1
      ) s on s.hour = h.hour
    ), '[]'::jsonb),
    'by_species', coalesce((
      select jsonb_agg(jsonb_build_object('species', species, 'scans', scans) order by scans desc)
      from (
        select species, sum(scans)::integer as scans
        from aquarium_scan_stats where room_code = v_room and hour_bucket >= v_from
        group by species
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Master-only RPCs (WonderLab owner)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_tank_plan(target_room text, admin_pin text, new_plan text, restart boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public._wf_check_pin(target_room, admin_pin);
  v_plan text := lower(btrim(coalesce(new_plan, '')));
begin
  if r = 'owner' then
    return jsonb_build_object('ok', false, 'error', 'MASTER_ONLY');
  end if;
  if r <> 'master' then
    return public._wf_pin_error(r);
  end if;
  if v_plan not in ('free', 'play', 'day', 'venue', 'legacy') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PLAN');
  end if;
  if not exists (select 1 from aquarium_tanks where room_code = public._wf_room(target_room)) then
    return jsonb_build_object('ok', false, 'error', 'TANK_NOT_FOUND');
  end if;
  perform public._wf_apply_plan(public._wf_room(target_room), v_plan, coalesce(restart, false));
  return jsonb_build_object('ok', true, 'tank', public._wf_tank_json(target_room));
end;
$$;

create or replace function public.admin_list_tanks(admin_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r text := public._wf_check_pin('', admin_pin);
begin
  if r <> 'master' then
    return jsonb_build_object('ok', false, 'error', case when r = 'locked' then 'PIN_LOCKED' else 'BAD_PIN' end);
  end if;
  return jsonb_build_object('ok', true, 'tanks', coalesce((
    select jsonb_agg(jsonb_build_object(
      'room_code', t.room_code,
      'title', t.title,
      'brand_name', t.brand_name,
      'plan_code', t.plan_code,
      'event_started_at', t.event_started_at,
      'event_ends_at', t.event_ends_at,
      'created_at', t.created_at,
      'custom_pin', coalesce(s.pin_hash is not null, false),
      'scans_7d', coalesce((select sum(scans) from aquarium_scan_stats st
                            where st.room_code = t.room_code and st.hour_bucket >= now() - interval '7 days'), 0),
      'scans_all', coalesce((select sum(scans) from aquarium_scan_stats st where st.room_code = t.room_code), 0)
    ) order by t.created_at desc)
    from aquarium_tanks t
    left join aquarium_tank_secrets s on s.room_code = t.room_code
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_change_master_pin(admin_pin text, new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r text := public._wf_check_pin('', admin_pin);
  v_pin text := btrim(coalesce(new_pin, ''));
begin
  if r <> 'master' then
    return jsonb_build_object('ok', false, 'error', case when r = 'locked' then 'PIN_LOCKED' else 'BAD_PIN' end);
  end if;
  if v_pin !~ '^[0-9]{6,12}$' then
    return jsonb_build_object('ok', false, 'error', 'WEAK_PIN');
  end if;
  update public.wonderfish_owner_settings set master_pin_hash = crypt(v_pin, gen_salt('bf')) where id = 1;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Old PIN RPCs (used by pages cached before this update).
--    They ONLY accept the legacy 1234 on tanks that never set a PIN and
--    never verify real PINs (no unthrottled brute-force path).
-- ---------------------------------------------------------------------
create or replace function public.reset_aquarium_room(target_room text, admin_pin text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_room text := public._wf_room(target_room); n integer;
begin
  if exists (select 1 from aquarium_tank_secrets where room_code = v_room and pin_hash is not null) then
    raise exception 'PIN_UPGRADE_REQUIRED: Please reload the page.';
  end if;
  if admin_pin is distinct from '1234' then
    raise exception 'Invalid Admin PIN';
  end if;
  delete from public.aquarium_fishes where room_code = v_room;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.delete_aquarium_fish(target_id uuid, admin_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_room text;
begin
  select room_code into v_room from public.aquarium_fishes where id = target_id;
  if not found then
    return false;
  end if;
  if exists (select 1 from aquarium_tank_secrets where room_code = v_room and pin_hash is not null) then
    raise exception 'PIN_UPGRADE_REQUIRED: Please reload the page.';
  end if;
  if admin_pin is distinct from '1234' then
    raise exception 'Invalid Admin PIN';
  end if;
  delete from public.aquarium_fishes where id = target_id;
  return found;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------
revoke all on function public._wf_room(text) from public, anon, authenticated;
revoke all on function public._wf_pin_error(text) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.get_tank_status(text)',
    'public.create_tank_with_pin(text, text, text)',
    'public.admin_login(text, text)',
    'public.admin_start_event(text, text)',
    'public.admin_change_pin(text, text, text)',
    'public.admin_set_branding(text, text, text, text, text, text)',
    'public.admin_reset_tank(text, text)',
    'public.admin_delete_fish(text, text, uuid)',
    'public.admin_tank_report(text, text, integer)',
    'public.admin_set_tank_plan(text, text, text, boolean)',
    'public.admin_list_tanks(text)',
    'public.admin_change_master_pin(text, text)',
    'public.reset_aquarium_room(text, text)',
    'public.delete_aquarium_fish(uuid, text)',
    'public.add_aquarium_fish(text, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
