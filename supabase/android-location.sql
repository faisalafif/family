-- Run in Supabase SQL Editor after schema.sql and location-provider.sql.
alter table public.locations add column if not exists source text;
alter table public.locations add column if not exists platform text;
alter table public.locations add column if not exists device_id uuid;
alter table public.locations add column if not exists event_id uuid;
alter table public.locations add column if not exists altitude double precision;
alter table public.locations add column if not exists speed double precision;
alter table public.locations add column if not exists bearing double precision;
alter table public.family_members add column if not exists last_source text;
alter table public.family_members add column if not exists last_provider text;
alter table public.family_members add column if not exists device_seen_at timestamptz;
alter table public.family_members add column if not exists admin_message text;
alter table public.family_members add column if not exists admin_message_updated_at timestamptz;

create unique index if not exists locations_event_id_idx on public.locations(event_id);
create index if not exists locations_device_recorded_idx on public.locations(device_id, recorded_at desc) where device_id is not null;

create table if not exists public.android_devices (
  device_id uuid primary key,
  member_id uuid not null references public.family_members(id) on delete cascade,
  platform text not null default 'ANDROID' check (platform = 'ANDROID'),
  created_at timestamptz not null default now(),
  last_seen timestamptz
);
create index if not exists android_devices_member_idx on public.android_devices(member_id);
alter table public.android_devices enable row level security;
-- No anon policies: only the Edge Functions' service role may read/write this registry.

create table if not exists public.android_device_status (
  device_id uuid primary key references public.android_devices(device_id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  location_permission boolean not null,
  background_permission boolean not null,
  foreground_service boolean not null,
  location_services boolean not null,
  network_online boolean not null,
  battery_optimization_exempt boolean not null,
  battery_percent integer check (battery_percent between 0 and 100),
  protection_enabled boolean not null default true,
  protection_paused_at timestamptz,
  queued_uploads integer not null default 0 check (queued_uploads between 0 and 500),
  reported_at timestamptz not null default now()
);
alter table public.android_device_status add column if not exists battery_percent integer;
alter table public.android_device_status add column if not exists protection_enabled boolean not null default true;
alter table public.android_device_status add column if not exists protection_paused_at timestamptz;
do $$ begin
  alter table public.android_device_status add constraint android_device_status_battery_percent_check
    check (battery_percent between 0 and 100);
exception when duplicate_object then null;
end $$;
create index if not exists android_device_status_member_idx on public.android_device_status(member_id);
alter table public.android_device_status enable row level security;
drop policy if exists "mvp android device status read" on public.android_device_status;
create policy "mvp android device status read"
  on public.android_device_status for select using (true);
grant select on public.android_device_status to anon, authenticated;
grant all on public.android_device_status to service_role;

do $$ begin
  alter publication supabase_realtime add table public.android_device_status;
exception when duplicate_object then null;
end $$;

-- Separate app-usage aggregates; never mix app activity with GPS location rows.
create table if not exists public.android_app_usage_daily (
  event_id text not null,
  device_id uuid not null references public.android_devices(device_id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  usage_date date not null,
  package_name text not null,
  app_name text not null,
  usage_ms bigint not null check (usage_ms between 0 and 86400000),
  last_used_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (device_id, usage_date, package_name),
  unique (event_id)
);
create index if not exists android_app_usage_member_date_idx
  on public.android_app_usage_daily(member_id, usage_date desc, usage_ms desc);
alter table public.android_app_usage_daily enable row level security;
grant all on public.android_app_usage_daily to service_role;

create table if not exists public.android_app_usage_status (
  device_id uuid primary key references public.android_devices(device_id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  collection_enabled boolean not null default false,
  usage_access_granted boolean not null default false,
  collection_status text not null check (collection_status in ('DISABLED', 'PERMISSION_REQUIRED', 'READY', 'INCOMPLETE')),
  collected_at timestamptz not null,
  reported_at timestamptz not null default now()
);
create index if not exists android_app_usage_status_member_idx
  on public.android_app_usage_status(member_id, reported_at desc);
alter table public.android_app_usage_status enable row level security;
grant all on public.android_app_usage_status to service_role;
