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
  max_session_hours numeric(4,1) not null default 8.0
                 check (max_session_hours > 0 and max_session_hours <= 24),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Add max_session_hours to existing staff_profiles tables (the create table
-- above only applies to fresh databases).
alter table public.staff_profiles
  add column if not exists max_session_hours numeric(4,1) not null default 8.0
  check (max_session_hours > 0 and max_session_hours <= 24);

-- One teacher, one grade: the short-lived multi-grade switcher is gone. Rows
-- that already got a grade_levels array keep their first grade.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'staff_profiles'
      and column_name = 'grade_levels'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'staff_profiles'
        and column_name = 'grade_level'
    ) then
      alter table public.staff_profiles add column grade_level text;
    end if;
    update public.staff_profiles
      set grade_level = grade_levels[1]
      where cardinality(grade_levels) > 0;
    alter table public.staff_profiles drop column grade_levels;
  end if;
end
$$;

alter table public.staff_profiles drop constraint if exists staff_grades_for_teachers;

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

-- Live stage of an in-flight capture ('place_1' -> 'lift' -> 'place_2') so the
-- web form can tell the user when to lift their finger. Null before the first
-- stage arrives and once the capture settles.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fingerprint_captures'
      and column_name = 'step'
  ) then
    alter table public.fingerprint_captures add column step text;
  end if;
end
$$;

-- The same queue also carries "clear this slot" rows, so a transfer can drop
-- the stale template through the service that owns the COM port.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fingerprint_captures'
      and column_name = 'action'
  ) then
    alter table public.fingerprint_captures
      add column action text not null default 'enroll'
      check (action in ('enroll', 'delete'));
  end if;
end
$$;

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

-- ── Table 7: attendance_marks (the teacher's daily override) ──────────
-- A scan says the finger was on the glass; only the teacher knows whether
-- the student then sat in class. One row per student per day, upserted from
-- the Attendance page, and it outranks whatever the scanner logged.
create table if not exists public.attendance_marks (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  mark_date  date not null default current_date,
  status     text not null check (status in ('Present', 'Late', 'Absent')),
  set_by     uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (student_id, mark_date)
);

-- ── Table 8: app_flags (one row, the switches you flip by hand) ────────
create table if not exists public.app_flags (
  id                 integer primary key default 1 check (id = 1),
  self_registration  boolean not null default true,
  updated_at         timestamptz not null default now()
);

-- ── Table 9: staff_time_logs (teacher/admin time-in & time-out) ────────
-- One row per staff member per day. time_out is null while the person is
-- still clocked in. A unique constraint on (staff_id, work_date) enforces
-- one active session per day; re-timing-in on the same day updates the
-- existing row rather than creating a duplicate.
create table if not exists public.staff_time_logs (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff_profiles(id) on delete cascade,
  work_date  date not null default current_date,
  time_in    timestamptz not null default now(),
  time_out   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, work_date)
);

create index if not exists staff_time_logs_staff_idx
  on public.staff_time_logs (staff_id);
create index if not exists staff_time_logs_date_idx
  on public.staff_time_logs (work_date);

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
alter table public.attendance_marks     enable row level security;
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

-- A teacher may override attendance for their own class only; the kiosk has
-- no business reading marks at all.
drop policy if exists "marks readable" on public.attendance_marks;
drop policy if exists "marks writable" on public.attendance_marks;

create policy "marks readable" on public.attendance_marks
  for select to authenticated using (
    public.is_admin()
    or public.student_grade(student_id) is not distinct from public.my_grade()
  );

create policy "marks writable" on public.attendance_marks
  for all to authenticated using (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and public.student_grade(student_id) is not distinct from public.my_grade())
  ) with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and public.student_grade(student_id) is not distinct from public.my_grade())
  );

-- ── Update a staff member's allotted session time ────────────────────
-- Teachers may set their own; admins may set anyone's. The value is the
-- maximum number of hours a teacher may stay clocked in before the app
-- logs them out automatically.
create or replace function public.set_max_session_hours(p_staff_id uuid, p_hours numeric)
returns public.staff_profiles
language plpgsql volatile security definer set search_path = public as
$$
declare
  v_row public.staff_profiles;
begin
  if p_hours is null or p_hours <= 0 or p_hours > 24 then
    raise exception 'Hours must be between 0.1 and 24';
  end if;

  update public.staff_profiles
     set max_session_hours = p_hours, updated_at = now()
   where id = p_staff_id
     and (public.is_admin() or auth_id = auth.uid())
  returning * into v_row;

  if v_row is null then
    raise exception 'Not found or not allowed';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.set_max_session_hours(uuid, numeric) from public;
grant execute on function public.set_max_session_hours(uuid, numeric) to authenticated;

-- ── Staff time-in / time-out ─────────────────────────────────────────
-- Teachers and admins clock in and out themselves; nobody else may read
-- or write these rows. The functions below are security definer so the
-- app can call them with the anon key from the signed-out kiosk too.
alter table public.staff_time_logs enable row level security;

drop policy if exists "time logs readable" on public.staff_time_logs;
drop policy if exists "time logs writable" on public.staff_time_logs;

create policy "time logs readable" on public.staff_time_logs
  for select using (staff_id = (select id from public.staff_profiles where auth_id = auth.uid()));

create policy "time logs writable" on public.staff_time_logs
  for all using (staff_id = (select id from public.staff_profiles where auth_id = auth.uid()))
  with check (staff_id = (select id from public.staff_profiles where auth_id = auth.uid()));

-- Clock the signed-in staff member in for today. Idempotent: a second
-- call on the same day returns the existing row rather than erroring.
create or replace function public.time_in()
returns public.staff_time_logs
language plpgsql volatile security definer set search_path = public as
$$
declare
  v_staff_id uuid;
  v_row public.staff_time_logs;
begin
  select id into v_staff_id
    from public.staff_profiles
   where auth_id = auth.uid() and status = 'active';

  if v_staff_id is null then
    raise exception 'No active staff profile for this account';
  end if;

  insert into public.staff_time_logs (staff_id, work_date, time_in)
  values (v_staff_id, current_date, now())
  on conflict (staff_id, work_date)
  do update set time_in = now(), updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.time_in() from public;
grant execute on function public.time_in() to authenticated;

-- Clock the signed-in staff member out for today. Returns the completed
-- row, or null if there was no open session.
create or replace function public.time_out()
returns public.staff_time_logs
language plpgsql volatile security definer set search_path = public as
$$
declare
  v_staff_id uuid;
  v_row public.staff_time_logs;
begin
  select id into v_staff_id
    from public.staff_profiles
   where auth_id = auth.uid() and status = 'active';

  if v_staff_id is null then
    raise exception 'No active staff profile for this account';
  end if;

  update public.staff_time_logs
     set time_out = now(), updated_at = now()
   where staff_id = v_staff_id
     and work_date = current_date
     and time_out is null
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.time_out() from public;
grant execute on function public.time_out() to authenticated;

-- The signed-in staff member's time row for today: null before they
-- clock in, with time_out still null while they are on the clock.
create or replace function public.my_time_status()
returns public.staff_time_logs
language sql stable security definer set search_path = public as
$$
  select l.*
    from public.staff_time_logs as l
    join public.staff_profiles as s on s.id = l.staff_id
   where s.auth_id = auth.uid()
     and l.work_date = current_date
   order by l.time_in desc
   limit 1;
$$;

revoke execute on function public.my_time_status() from public;
grant execute on function public.my_time_status() to authenticated;

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

-- ── The signed-out Scan Station ──────────────────────────────────────
-- A classroom display is left logged out so students can check in before
-- any teacher arrives; the Python service records scans either way. Security
-- definer because anon has no roster policy to lean on, and the payload is
-- deliberately tiny: the newest scan of the day plus a head count, never the
-- class list. p_since is the browser's local midnight, the same "today" every
-- other query in the app uses.
create or replace function public.kiosk_pulse(p_since timestamptz)
returns table (
  log_id          uuid,
  first_name      text,
  last_name       text,
  grade_level     text,
  status          text,
  scan_time       timestamptz,
  parent_notified boolean,
  checked_in      bigint
)
language sql stable security definer set search_path = public as
$$
  select newest.log_id,
         newest.first_name,
         newest.last_name,
         newest.grade_level,
         newest.status,
         newest.scan_time,
         newest.parent_notified,
         totals.checked_in
    from (
      select count(distinct student_id) as checked_in
        from public.attendance_logs
       where scan_time >= p_since
    ) as totals
    left join lateral (
      select l.id as log_id,
             s.first_name,
             s.last_name,
             s.grade_level,
             l.status,
             l.scan_time,
             l.parent_notified
        from public.attendance_logs as l
        join public.students as s on s.id = l.student_id
       where l.scan_time >= p_since
       order by l.scan_time desc
       limit 1
    ) as newest on true;
$$;

revoke execute on function public.kiosk_pulse(timestamptz) from public;
grant execute on function public.kiosk_pulse(timestamptz) to anon, authenticated;

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

-- Capture stages change several times per enrolment and the modal coaches a
-- person with their finger on the glass, so polling is too slow: push them.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fingerprint_captures'
  ) then
    alter publication supabase_realtime add table public.fingerprint_captures;
  end if;
end
$$;

-- A teacher's manual mark must reach every open screen as fast as a scan does,
-- otherwise two devices disagree about who is present for up to a poll cycle.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_marks'
  ) then
    alter publication supabase_realtime add table public.attendance_marks;
  end if;
end
$$;

-- Every policy scopes through my_grade(); the multi-grade accessor from the
-- short-lived switcher experiment is gone. Dropped last so no stale policy
-- still depends on it.
drop function if exists public.my_grades();
