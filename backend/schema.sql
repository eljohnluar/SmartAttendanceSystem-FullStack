-- Smart Attendance System — Supabase schema
-- Run in Supabase Studio > SQL Editor (new query), then Execute.
-- Safe to re-run after edits: everything is if-not-exists or create-or-replace.

create extension if not exists "pgcrypto";

-- ── Table 1: students ────────────────────────────────────────────────
create table if not exists public.students (
  id              uuid primary key default gen_random_uuid(),
  fingerprint_id  integer not null unique,
  student_number  text,
  first_name      text not null,
  last_name       text not null,
  grade_level     text not null,
  section         text,
  parent_email    text not null,
  fingerprint_template text,
  created_at      timestamptz not null default now()
);

-- The school's own identifier for the child — the number on its forms and ID
-- card. Optional, because enrollment can happen before the office issues one.
alter table public.students
  add column if not exists student_number text;

comment on column public.students.student_number is
  'School student ID as typed by the admin. Unique when present; the uuid id and the fingerprint_id are separate.';

-- A partial index keeps it unique without forcing everyone to have one: Postgres
-- lets any number of rows leave it null.
create unique index if not exists students_student_number_key
  on public.students (student_number)
  where student_number is not null;

-- The class a student belongs to inside their grade, e.g. "A" or "Blue".
alter table public.students
  add column if not exists section text;

-- The Live20R has no memory of its own. This is the merged template, held as
-- base64 text, that the backend loads back into the scanner on every start.
alter table public.students
  add column if not exists fingerprint_template text;

comment on column public.students.fingerprint_template is
  'Base64 ZKFinger template. A mathematical description of the print, not an image.';

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
  grades         text[] not null default '{}',
  sections       text[] not null default '{}',
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

-- Folds the old grade_levels array experiment into grade_level for any database
-- that still has it. The current multi-grade column is grades, added below.
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

-- A professor may teach several grades. grades is the list that scopes their
-- login; grade_level always names the first of them, so every single-grade
-- reader — the teacher pages, the kiosk pulse, the daily reset — keeps working.
-- An empty list falls back to grade_level, which covers rows written before the
-- array existed.
alter table public.staff_profiles
  add column if not exists grades text[] not null default '{}';

update public.staff_profiles
  set grades = array[grade_level]
  where grade_level is not null and cardinality(grades) = 0;

update public.staff_profiles
  set grade_level = grades[1]
  where cardinality(grades) > 0 and grade_level is distinct from grades[1];

-- A professor may be narrowed to particular sections of their grades. An empty
-- list means every section, which is how every row predating this column
-- already behaved.
alter table public.staff_profiles
  add column if not exists sections text[] not null default '{}';

alter table public.staff_profiles drop constraint if exists staff_grades_for_teachers;

-- Teachers name at least one grade; admins may leave both columns empty.
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

-- The professor a student is assigned to, for the roster's "choose teacher"
-- picker. It is a label the admin sets, not a permission: row-level security
-- still scopes every read and write through owns(). Deleting the professor
-- leaves the students standing with the assignment cleared.
alter table public.students
  add column if not exists teacher_id uuid;

alter table public.students drop constraint if exists students_teacher_id_fkey;

alter table public.students
  add constraint students_teacher_id_fkey
  foreign key (teacher_id) references public.staff_profiles(id) on delete set null;

-- ── Table 5: fingerprint_captures ────────────────────────────────────
-- The browser cannot touch the USB scanner, so "Enroll fingerprint" on the
-- student form queues a row here and the Python service performs the three-scan
-- capture and writes the resulting template onto the student's row.
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

-- Live stage of an in-flight capture ('place_1' -> 'place_2' -> 'place_3' ->
-- 'merge') so the web form can coach the student through the three presses.
-- Null before the first stage arrives and once the capture settles.
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

-- The same queue also carries "clear this ID" rows, so a transfer can drop the
-- stale print from both the scanner and the student's row.
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

create or replace function public.my_grades() returns text[]
language sql stable security definer set search_path = public as
$$
  -- grades is the source of truth; grade_level covers rows written before the
  -- array existed. Never null, so `= any(...)` denies cleanly instead of
  -- turning the whole policy into null.
  select coalesce(
    (select case
              when cardinality(sp.grades) > 0 then sp.grades
              else array_remove(array[sp.grade_level], null)
            end
       from public.staff_profiles sp
      where sp.auth_id = auth.uid() and sp.status = 'active'),
    '{}'
  );
$$;

-- The sections a professor is limited to, across whichever grades they teach.
-- An empty list (or a login with no staff row) means every section.
create or replace function public.my_sections() returns text[]
language sql stable security definer set search_path = public as
$$
  -- Never null: a login with no staff row gets an empty list, which owns()
  -- reads as "no grade at all" rather than as "every section".
  select coalesce(
    (select array_remove(sp.sections, null)
       from public.staff_profiles sp
      where sp.auth_id = auth.uid() and sp.status = 'active'),
    '{}'
  );
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

create or replace function public.student_section(p_student_id uuid) returns text
language sql stable security definer set search_path = public as
$$
  select section from public.students where id = p_student_id;
$$;

-- Whether a staff member may reach a given student: one of their grades, and one
-- of their sections when they have been narrowed to any. Reading a student
-- through their log rows goes the same way, so a professor cannot see attendance
-- for a section they do not teach.
create or replace function public.owns(p_grade text, p_section text) returns boolean
language sql stable security definer set search_path = public as
$$
  select p_grade = any(public.my_grades())
    and (cardinality(public.my_sections()) = 0
         or coalesce(p_section, '') = any (public.my_sections()));
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
-- admin   : everything, including managing staff
-- teacher : read, enroll, edit and delete students in their own grades and
--           sections only
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
    or public.owns(grade_level, section)
  );

create policy "students creatable" on public.students
  for insert with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and public.owns(grade_level, section))
  );

create policy "students editable" on public.students
  for update using (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and public.owns(grade_level, section))
  ) with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and public.owns(grade_level, section))
  );

create policy "students deletable" on public.students
  for delete using (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and public.owns(grade_level, section))
  );

create policy "logs readable" on public.attendance_logs
  for select using (
    public.is_public_kiosk() or public.is_admin()
    or public.owns(public.student_grade(student_id), public.student_section(student_id))
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
    public.is_admin() or grade_level = any(public.my_grades())
  );

create policy "grade settings creatable" on public.grade_settings
  for insert to authenticated with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and grade_level = any(public.my_grades()))
  );

create policy "grade settings editable" on public.grade_settings
  for update to authenticated using (
    public.is_admin() or grade_level = any(public.my_grades())
  ) with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and grade_level = any(public.my_grades()))
  );

-- A teacher may override attendance for their own class only; the kiosk has
-- no business reading marks at all.
drop policy if exists "marks readable" on public.attendance_marks;
drop policy if exists "marks writable" on public.attendance_marks;

create policy "marks readable" on public.attendance_marks
  for select to authenticated using (
    public.is_admin()
    or public.owns(public.student_grade(student_id), public.student_section(student_id))
  );

create policy "marks writable" on public.attendance_marks
  for all to authenticated using (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and public.owns(public.student_grade(student_id), public.student_section(student_id)))
  ) with check (
    public.is_admin()
    or (public.my_role() = 'teacher'
        and public.owns(public.student_grade(student_id), public.student_section(student_id)))
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
              and p_grade = any(public.my_grades())) then
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

-- Teachers scope through my_grades()/my_sections() via owns(). The single-grade
-- accessor it replaces is dropped last, so no stale policy still depends on it.
drop function if exists public.my_grade();
