-- Smart Attendance System — Supabase schema
-- Run in Supabase Studio > SQL Editor (new query), then Execute.
-- Safe to re-run after edits: everything is if-not-exists or create-or-replace.

create extension if not exists "pgcrypto";

-- ── Table 1: students ────────────────────────────────────────────────
create table if not exists public.students (
  id              uuid primary key default gen_random_uuid(),
  fingerprint_id  integer not null unique,
  first_name      text not null,
  last_name       text not null,
  grade_level     text not null,
  parent_email    text not null,
  created_at      timestamptz not null default now()
);

-- ── Table 2: attendance_logs ─────────────────────────────────────────
create table if not exists public.attendance_logs (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students(id) on delete cascade,
  scan_time        timestamptz not null default now(),
  status           text not null default 'Present',
  parent_notified  boolean not null default false
);

create index if not exists attendance_logs_scan_time_idx
  on public.attendance_logs (scan_time desc);
create index if not exists attendance_logs_student_idx
  on public.attendance_logs (student_id);

-- ── Table 3: backend_status (single row the Python service heartbeats) ──
create table if not exists public.backend_status (
  id              integer primary key default 1 check (id = 1),
  connected       boolean not null default false,
  port            text,
  last_heartbeat  timestamptz,
  scans_today     integer not null default 0,
  message         text
);

-- ── Table 4: staff_profiles (admins, teachers, and the signup queue) ──
-- A row starts life as 'pending' when an admin adds someone on the Staff
-- page. The Python service polls for pending rows, creates the matching
-- auth.users login with its service-role key, then flips the row to
-- 'active' and stores the one-time password for the admin to hand over.
create table if not exists public.staff_profiles (
  id             uuid primary key default gen_random_uuid(),
  auth_id        uuid unique,
  email          text not null unique,
  full_name      text not null,
  role           text not null check (role in ('admin', 'teacher')),
  grade_level    text,
  status         text not null default 'pending'
                 check (status in ('pending', 'active', 'failed')),
  temp_password  text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Teachers are scoped to exactly one grade; admins may leave it null.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_grade_for_teachers'
  ) then
    alter table public.staff_profiles
      add constraint staff_grade_for_teachers
      check (role = 'admin' or grade_level is not null);
  end if;
end
$$;

-- ── Table 5: fingerprint_captures ────────────────────────────────────
-- The browser cannot open the COM port, so "Enroll fingerprint" on the
-- student form queues a row here and the Python service performs the capture
-- on the sensor and writes the resulting memory slot back.
create table if not exists public.fingerprint_captures (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'pending'
                 check (status in ('pending', 'capturing', 'done', 'failed', 'expired')),
  target_slot    integer,
  fingerprint_id integer,
  error          text,
  requested_by   uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── Table 6: grade_settings (when a class starts, and how much slack) ─
-- Absent means a row simply never appears, so each grade stores its own late
-- threshold here. The Python service reads it at scan time; without a row it
-- falls back to SCHOOL_START_TIME / LATE_GRACE_MINUTES from .env.
create table if not exists public.grade_settings (
  grade_level        text primary key,
  school_start       time not null default '08:00',
  late_grace_minutes integer not null default 15
                     check (late_grace_minutes between 0 and 180),
  updated_at         timestamptz not null default now()
);

-- ── Table 7: app_flags (one row, the switches you flip by hand) ────────
create table if not exists public.app_flags (
  id                 integer primary key default 1 check (id = 1),
  self_registration  boolean not null default true,
  updated_at         timestamptz not null default now()
);

-- Seeded open while the system is under development so you can register as many
-- test accounts as you like. do-nothing on purpose: re-running this file must
-- never quietly re-open a door you closed. Close it before a school uses this:
--
--   update public.app_flags set self_registration = false;
insert into public.app_flags (id) values (1) on conflict (id) do nothing;

-- ── Accessor functions ───────────────────────────────────────────────
-- security definer so the bodies read staff_profiles without re-triggering
-- the very policies that call them (which would recurse).
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$
  select role from public.staff_profiles
  where auth_id = auth.uid() and status = 'active';
$$;

create or replace function public.my_grade() returns text
language sql stable security definer set search_path = public as
$$
  select grade_level from public.staff_profiles
  where auth_id = auth.uid() and status = 'active';
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$
  select coalesce(public.my_role() = 'admin', false);
$$;

-- The entrance kiosk has no login, so a request carrying no user JWT is the
-- public display rather than an unauthenticated staff member.
create or replace function public.is_public_kiosk() returns boolean
language sql stable set search_path = public as
$$
  select coalesce(auth.jwt() ->> 'role', 'anon') = 'anon';
$$;

create or replace function public.student_grade(p_student_id uuid) returns text
language sql stable security definer set search_path = public as
$$
  select grade_level from public.students where id = p_student_id;
$$;

-- True once any admin row exists, including one still waiting to be
-- provisioned. The register screen uses it to lock itself after bootstrap.
-- security definer so callers may ask without being able to read the table.
create or replace function public.admin_exists() returns boolean
language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from public.staff_profiles where role = 'admin'
  );
$$;

revoke execute on function public.admin_exists() from public;
grant execute on function public.admin_exists() to anon, authenticated;

-- Whether the register screen may create another account. Open while no admin
-- exists at all, and afterwards only while the development flag says so. A
-- missing flag row reads as closed, so this fails shut.
create or replace function public.registration_open() returns boolean
language sql stable security definer set search_path = public as
$$
  select (not public.admin_exists())
    or coalesce((select self_registration from public.app_flags where id = 1), false);
$$;

revoke execute on function public.registration_open() from public;
grant execute on function public.registration_open() to anon, authenticated;

-- ── Row level security ───────────────────────────────────────────────
-- admin   : everything, including deleting students and managing staff
-- teacher : read and enroll students in their own grade only
-- anon    : the public kiosk may read the roster and the log
-- The Python service uses the service-role key, which bypasses all of this.
alter table public.students             enable row level security;
alter table public.attendance_logs      enable row level security;
alter table public.backend_status       enable row level security;
alter table public.staff_profiles       enable row level security;
alter table public.fingerprint_captures enable row level security;
alter table public.grade_settings       enable row level security;
-- Deliberately has no policies at all: nobody holding the anon key may read or
-- flip the flag, which is why registration_open() is security definer. Only the
-- service role and you, in the SQL editor, can change it.
alter table public.app_flags            enable row level security;

drop policy if exists "students readable"   on public.students;
drop policy if exists "students creatable"  on public.students;
drop policy if exists "students editable"   on public.students;
drop policy if exists "students deletable"  on public.students;
drop policy if exists "logs readable"       on public.attendance_logs;
drop policy if exists "status readable"     on public.backend_status;
drop policy if exists "staff readable"      on public.staff_profiles;
drop policy if exists "staff writable"      on public.staff_profiles;
drop policy if exists "staff bootstrap admin" on public.staff_profiles;
drop policy if exists "staff editable"      on public.staff_profiles;
drop policy if exists "staff deletable"     on public.staff_profiles;

create policy "students readable" on public.students
  for select using (
    public.is_public_kiosk() or public.is_admin()
    or grade_level is not distinct from public.my_grade()
  );

create policy "students creatable" on public.students
  for insert with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and grade_level is not distinct from public.my_grade())
  );

create policy "students editable" on public.students
  for update using (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and grade_level is not distinct from public.my_grade())
  ) with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and grade_level is not distinct from public.my_grade())
  );

create policy "students deletable" on public.students
  for delete using (public.is_admin());

create policy "logs readable" on public.attendance_logs
  for select using (
    public.is_public_kiosk() or public.is_admin()
    or public.student_grade(student_id) is not distinct from public.my_grade()
  );

create policy "status readable" on public.backend_status
  for select using (true);

create policy "staff readable" on public.staff_profiles
  for select using (public.is_admin() or auth_id = auth.uid());

create policy "staff writable" on public.staff_profiles
  for insert with check (public.is_admin());

-- A signed-up user may claim an admin row for themselves while
-- registration_open() says yes: always for the very first one, afterwards only
-- while the development flag is on. Close that flag and this stops being a way
-- in — the row-level security is the gate, not the register screen.
create policy "staff bootstrap admin" on public.staff_profiles
  for insert to authenticated with check (
    auth_id = auth.uid()
    and role = 'admin'
    and public.registration_open()
  );

create policy "staff editable" on public.staff_profiles
  for update using (public.is_admin()) with check (public.is_admin());

create policy "staff deletable" on public.staff_profiles
  for delete using (public.is_admin());

-- Signed-in staff may queue a capture and read capture results. Only the
-- Python service may write the outcome, so a visitor cannot fake a slot.
drop policy if exists "captures readable" on public.fingerprint_captures;
drop policy if exists "captures creatable" on public.fingerprint_captures;

create policy "captures readable" on public.fingerprint_captures
  for select to authenticated using (true);

create policy "captures creatable" on public.fingerprint_captures
  for insert to authenticated with check (requested_by = auth.uid());

-- ── Per-grade late rule ──────────────────────────────────────────────
-- A teacher sets the rule for their own class; an admin may set any class.
drop policy if exists "grade settings readable" on public.grade_settings;
drop policy if exists "grade settings creatable" on public.grade_settings;
drop policy if exists "grade settings editable" on public.grade_settings;

create policy "grade settings readable" on public.grade_settings
  for select to authenticated using (
    public.is_admin() or grade_level is not distinct from public.my_grade()
  );

create policy "grade settings creatable" on public.grade_settings
  for insert to authenticated with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and grade_level is not distinct from public.my_grade())
  );

create policy "grade settings editable" on public.grade_settings
  for update to authenticated using (
    public.is_admin() or grade_level is not distinct from public.my_grade()
  ) with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and grade_level is not distinct from public.my_grade())
  );

-- ── Clear one grade's attendance ─────────────────────────────────────
-- The Reset button. security definer because the delete has to see the other
-- side of the students join; the guard inside is what keeps a teacher to their
-- own class. p_since is the browser's local midnight, so "today" means the same
-- thing here as it does in every other query the app makes.
create or replace function public.reset_grade_attendance(p_grade text, p_since timestamptz)
returns integer
language plpgsql volatile security definer set search_path = public as
$$
declare
  cleared integer;
begin
  if p_since is null then
    raise exception 'A starting time is required';
  end if;
  if not public.is_admin()
     and not (public.my_role() = 'teacher'
              and p_grade is not distinct from public.my_grade()) then
    raise exception 'You may only reset your own grade';
  end if;

  with gone as (
    delete from public.attendance_logs as l
    where l.scan_time >= p_since
      and exists (
        select 1 from public.students as s
        where s.id = l.student_id and s.grade_level is not distinct from p_grade
      )
    returning 1
  )
  select count(*) into cleared from gone;
  return cleared;
end;
$$;

revoke execute on function public.reset_grade_attendance(text, timestamptz) from public;
grant execute on function public.reset_grade_attendance(text, timestamptz) to authenticated;

-- ── Bootstrap the first admin ────────────────────────────────────────
-- Chicken and egg: adding staff now needs an admin, so the very first one is
-- queued here. Run the Python service afterwards and it will create the
-- login and print the password in the Staff page.
--
--   select public.create_admin('you@gmail.com', 'Your Name');
create or replace function public.create_admin(p_email text, p_full_name text)
returns text language sql security definer set search_path = public as
$$
  insert into public.staff_profiles as s (email, full_name, role, status)
  values (lower(trim(p_email)), trim(p_full_name), 'admin', 'pending')
  on conflict (email) do nothing
  returning 'queued: ' || s.email || ' — start the Python service to finish it';
$$;

-- ── Realtime ─────────────────────────────────────────────────────────
-- attendance_logs drives the kiosk; staff_profiles lets the Staff page flip
-- from "pending" to "active" on its own once the service provisions a login.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_logs'
  ) then
    alter publication supabase_realtime add table public.attendance_logs;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_profiles'
  ) then
    alter publication supabase_realtime add table public.staff_profiles;
  end if;
end
$$;
