# Smart Attendance System

Fingerprint attendance for a school entrance: a student scans a finger on a
ZKTeco Live20R plugged into the backend machine over USB, the Python service
matches it there, logs the arrival in Supabase, emails the parent, and the kiosk
screen at the door updates itself.

```
Student finger ─► Live20R (USB) ─► Python backend ─► Supabase ─► Gmail/Brevo ─► Parent
                     ▲  matches in software │            │
                     └── templates loaded ─┘            └─ Realtime ─► React kiosk
                     at every start                        heartbeat ─► Dashboard status
```

| Folder | What lives there |
| --- | --- |
| `backend/` | Python service: scanner driver, matcher, Supabase writer, email sender |
| `backend/zkfp.py` | ctypes bindings for the ZKFinger SDK (`libzkfp.dll`) |
| `backend/schema.sql` | Tables, row-level security, realtime publication |
| `frontend/` | Vite + React app: kiosk, enrollment, dashboard, staff login |

The Live20R has no memory of its own and does no matching of its own: every
print lives in `students.fingerprint_template` and is loaded back into the
scanner's temporary memory each time the service starts. So the ZKFinger SDK has
to stay installed on the machine that runs the backend, and the scanner has to
stay plugged into that same machine.

---

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free plan is enough).
2. Open **SQL Editor → New query**, paste the whole of `backend/schema.sql`, **Run**.
3. **Project Settings → API** gives you the Project URL, the `anon public` key and
   the `service_role` key.

## 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate                     # Windows   (Mac/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env                     # then fill it in
python main.py --status                    # confirms what it found
```

`backend/.env` keys:

| Key | Purpose | If blank |
| --- | --- | --- |
| `SUPABASE_URL` | project URL | logs go to `backend/demo_data.json` |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side writes | as above |
| `SCANNER_MODE` | `auto` (default), `usb`, `simulate` | see below |
| `SCANNER_MATCH_THRESHOLD` | how strict a match is, 1-100 | keeps the SDK default |
| `BREVO_API_KEY` | parent emails (~300/day free) | tries Resend, then Gmail |
| `RESEND_API_KEY` | emails (~100/day, needs a verified domain) | — |
| `GMAIL_ADDRESS` + `GMAIL_APP_PASSWORD` | Gmail SMTP (~50/day on a free account) | emails print to the console |
| `DUPLICATE_SCAN_MINUTES` | ignore a re-scan inside this window | default 45 |

Run it with `python main.py`. That also serves the built web app at
`http://localhost:8766` — loopback only, never the network — so one machine can
run the whole system without Node; add `--open` to launch the browser, `--no-web`
to skip it, and `WEB_PORT` in `.env` to move the port. `SCANNER_MODE=auto` uses the USB scanner and, if
none answers, falls back to the keyboard so you can keep working: type `1` to
fake a scan, `e 4` to present a fresh finger for enrolment, `x` for an
unreadable print, `r` to list loaded IDs, `q` to quit. Set `SCANNER_MODE=usb` at
school so a missing scanner is an error rather than a silent keyboard.

## 3. Scanner

1. Install **ZKFinger SDK (Windows Standard)** on the machine that will run the
   backend — `setup.exe` puts `libzkfp.dll` in `C:\Windows\System32`, where the
   backend finds it. Use a 64-bit Python; a 32-bit one cannot load it.
2. Plug the Live20R into USB. Windows should enumerate it without extra drivers.
3. `python main.py --status` reports how many scanners the SDK can see.
4. Re-run `backend/schema.sql` in Supabase if the database predates this version:
   it adds `students.fingerprint_template`, which is where the prints live now.

Existing students have no stored print, so every one of them needs re-enrolling
once — the old templates were held in the Arduino's sensor memory and never left
it.

## 4. Frontend

```bash
cd frontend
npm install
copy .env.example .env      # paste VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                 # http://localhost:5173
```

Use the **anon** key here, never the service-role key — it ships inside the
JavaScript bundle, so anything the browser can do is enforced by the row-level
security policies in `schema.sql`.

With no keys filled in the app runs on demo data held in the browser, which is
how you can click through all three screens before the hardware exists. Demo mode
signs you in as an admin; because the kiosk is teacher-only, switch persona with

```js
localStorage.setItem('smartattendance.demo.v1.role', 'teacher')  // then reload
```

Each role gets its own menu; the sidebar lists only what you may open. A top bar
carries the product name, the backend status and a profile icon whose menu holds
the signed-in email and sign out — deliberately no name or role text in the bar.

**Admin**

| Route | Screen |
| --- | --- |
| `#/home` | Dashboard — school totals, per-grade breakdown, latest scans |
| `#/add-staff` | Add Staff — queue a teacher or admin with a password |
| `#/teachers` | Professor Management — assign grades and sections, reveal passwords, retry provisioning |
| `#/roster` | Student Management — the whole roster: enroll, edit a student's details inline, move them between grades and sections, delete |
| `#/attendance` | Attendance — today's log and search |
| `#/reports` | Reports — arrivals by day, today's split, students per grade, teachers by class size, parent notifications |

**Teacher**

| Route | Screen |
| --- | --- |
| `#/kiosk` | Live kiosk — the entrance display, first in the teacher menu |
| `#/home` | Dashboard — their grade's present, late and absent list |
| `#/students` | Students — roster with grade and section filters, search, a count, print, inline **Edit**, and **Add student** in a modal scoped to what they teach |
| `#/attendance` | Attendance — filtered to their grades and sections by row-level security |
| `#/my-reports` | Reports — arrivals by day, today's split, students per class and parent notifications, their classes only |
| `#/profile` | My Profile — their own account record and the classes it reaches, read-only |

| Route | Screen | Who may open it |
| --- | --- | --- |
| `#/register` | create the first admin | anyone, until an admin exists |

Signed-out visitors get no navigation at all — just the sign-in card, with a
**Sign up** button. That means **the entrance monitor must be signed in as a
teacher** to show the kiosk; Supabase keeps the session in local storage, so
signing in once is enough. Below 900px the sidebar collapses to a horizontal bar.

## 5. Roles

| Role | Students | Attendance | Staff accounts |
| --- | --- | --- | --- |
| **admin** | read, enroll, edit, delete across every grade | whole school | manage |
| **teacher** | read, enroll, edit and delete **their grades, and only their sections of them** | that scope | none |
| *anon* | read (this is what the public kiosk uses) | read | none |

Two columns do the scoping: `staff_profiles.grades` (a list; `grade_level` keeps
naming its first entry so single-grade readers stay working) and
`staff_profiles.sections` (also a list, possibly empty). `owns(grade, section)`
in `schema.sql` combines them, and every policy goes through it — so a teacher
cannot read another class even by calling the API directly. An empty section
list means every section of their grades, which is how every staff row predating
the columns still behaves. Students carry their own `students.section`, and a
professor narrowed to sections can only enroll students into those.

A professor with more than one grade picks the one they are working in at the
top of the Students page; the roster, the late rule and the Add student form all
follow that choice.

On the admin **Student Management** page, Add student and Edit student both start
with a *Teacher* picker. Choosing a professor narrows the grade and section
controls to the entries on their `staff_profiles` row, and changing the teacher
clears a grade or section the new one does not teach, so nothing is saved that
their own login could not reach. The pairing lives in `students.teacher_id`,
which is a label the admin sets — permissions still come from `owns()`, and
deleting a professor leaves their students standing with the label cleared.

### Registering accounts

An admin registration is confirmed by email now, so set the mailer up first —
**Studio → Authentication → Emails → SMTP Settings → Enable custom SMTP**. Use
Gmail: this panel only ever delivers confirmation links, so Gmail's handful of
messages a day is no constraint, and it costs no extra account or key.

| Field | Value |
| --- | --- |
| Host | `smtp.gmail.com` |
| Port | `587` |
| Username | your Gmail address |
| Password | a **16-character app password**, not the account password |
| Sender email | the same Gmail address |

The app password comes from **myaccount.google.com → Security → 2-Step
Verification → App passwords** — 2-step verification has to be switched on for
that page to exist, and the password is generated once and shown only then.
Google's own sending cap (~50 recipients a day, and it drops to ~100/day for a
young account) applies, which is not a problem at this volume. If a school ever
wants the links to come from its own domain instead, Brevo's SMTP relay works
too — host `smtp-relay.brevo.com`, same port, and an **SMTP key** from
Brevo → SMTP & API, which is a different secret from the `BREVO_API_KEY` the
service uses.

Then switch confirmation on — **Studio → Authentication → Sign In / Up → Email →
tick "Confirm email"**.

Custom SMTP beats Supabase's built-in sender because that one is capped at **2
emails an hour** on the free plan, which is easy to exhaust while several people
register at once — and the sign-in codes below go through this same mailer, one
per session, so the built-in cap would be felt within minutes of a school
starting its day.

Open `#/register`, fill it in, and the account is created but not signed in: the
confirmation link has to be opened first. Sign in after that, and the app creates
the admin row for you on the spot — which is why the name is collected on the
register screen and carried in the account's metadata.

Registration is open right now, so you can create as many accounts as you want
while the system is being built. `app_flags.self_registration` decides it, and
`schema.sql` seeds that flag to `true`. The register screen and the row-level
security policy both ask `registration_open()`, so the gate is enforced in
Postgres rather than in the UI — hiding the screen would not be a control.

**Close it before a school uses this**, or anyone with the URL can make
themselves an admin:

```sql
update public.app_flags set self_registration = false;
```

After that the screen still works for the very first admin — with none in the
table there is nobody to lock anyone out — and closes itself from then on.
`app_flags` has row-level security enabled and no policies, so the anon key
cannot read or flip the flag; change it in the SQL editor or as the service role.

If `registration_open()` is missing because `schema.sql` has not been re-run,
the screen reports "Cannot check registration status" rather than assuming it
may open — fail closed, not open.

Prefer SQL? This queues an admin for the Python service to provision instead:

```sql
select public.create_admin('you@gmail.com', 'Your Name');
```

### Sign-in codes

A password alone is not enough to see a class. After it, the app asks for a
6-digit code that **Supabase** emails, and until that code is answered every
read and write behaves as though the account had no role at all — the gate sits
in `login_ok()`, which `my_role()`, `my_grades()` and `my_sections()` are built
on, so it is enforced by row-level security rather than by a screen hiding
itself. A correct password in the wrong hands gets you nothing.

How it works:

1. The app calls `signInWithOtp({ email, options: { shouldCreateUser: false } })`.
   Supabase makes up the code and posts it through the SMTP settings from
   [§5](#registering-accounts).
2. The app calls `verifyOtp({ email, token, type: 'email' })`. On a match
   Supabase swaps the password session for one that came through the code.
3. `login_ok()` reads the `amr` claim of that token — the methods used to sign
   in — and answers true only when the code is one of them.

Nothing in the database holds the code, its hash, or even a record that it was
answered, which is what makes the third step safe: there is no row a client
could write to open the gate, and no table to clean up when a code expires.
Supabase handles the expiry, the wrong-guess limit and the resend cooldown;
**Studio → Authentication → Rate Limits → Email OTP** is where the cooldown and
per-hour ceiling live, and **Authentication → Sessions** decides how long a
session lasts. Because the proof belongs to the session, a code is needed once
per session rather than once per hour — nobody is emailed every time the tab
reloads.

Three consequences worth knowing:

- **That SMTP panel now carries login traffic, not just the odd confirmation
  link.** Gmail's ~50 recipients a day was comfortable for registrations alone;
  one code per sign-in is a different volume, and 25 staff signing in twice a
  day reaches it. If it is tight, switch the panel to Brevo's SMTP relay
  (~300 a day, no domain verification needed) — the panel accepts it exactly as
  it accepts Gmail.
- **Sign-in no longer depends on the Python service.** It only needs the service
  for the scanner and for parent notices, so switching that machine off no
  longer locks everyone out of the app.
- Staff and professor accounts still get **no** confirmation email when an admin
  adds them — they are created already confirmed, and only meet the code at
  their first sign-in.

It ships switched off, so applying the schema cannot lock a school out before
the web app is updated. Turn it on when it is:

```sql
update public.app_flags set require_login_otp = true;
```

and back off again the same way if a mailbox or a provider ever stops answering.


### How provisioning works

The browser holds only the anon key, which cannot create auth users. So the
Staff page writes a `pending` row and the Python service — which does hold the
service-role key — polls for pending rows, calls Supabase's admin API, and
flips the row to `active`.

The Staff form has a **Password** box with a **Generate** button. Type one to
pick the account's password yourself, press Generate for a random one that skips
ambiguous characters, or leave it blank and the service invents one. Either way
the password shows on the row so you can hand it over, and **Done** clears it
from the database. Until then it sits in plain text in
`staff_profiles.temp_password`, which is why it is meant to be changed on first
sign-in — there is no change-password screen yet, so use Studio's *Send password
recovery* for that.

Two consequences worth knowing:

- **The backend must be running while you onboard staff.** Otherwise rows stay
  `pending`, and the app says so rather than failing silently.
- **Removing someone deletes only their staff row.** Their login still exists in
  Supabase but has no role, so every policy denies them. Delete the auth user in
  Studio if you want the email retired entirely.

Passwords are stored in plain text in `staff_profiles.temp_password` until you
click **Done**, which clears the column. They are meant to be changed on first
sign-in; there is no change-password screen yet, so use Studio's *Send password
recovery* for that until there is.

## 6. Enrolling students

The teacher's Students page is the roster as a table with **Add student** beside
the heading; pressing it opens the form in a modal. The admin's Student
Management page works the same way, and both tables carry an **Edit** button that
turns the row into the same fields inline. Either way, fill it in — the **Student
ID** is the number the school already uses and may be left blank, while the
**Fingerprint ID** is the number a scan is matched back to — and press
**Add student**. The row is saved first, and the modal then moves on to
**Enroll fingerprint**. Press it, then take the three prints: press the finger
flat and hold still, **lift it off completely**, and repeat. The three merge into
one template that is saved on that student's row.

There is one modal, never two stacked: saving swaps the form for the capture step
in place.

Closing the modal (Escape, the ×, or **Do it later**) never discards the student —
the row is already saved. They just have no print yet, so scans will report
"not recognised" until you enroll them.

Saving before capturing is deliberate: if the finger is unreadable, timed out or
the backend is offline, the student still exists and you can press the button
again. The capture is told which Fingerprint ID to use, so the template lands on
that student's row and the two can never disagree about an ID.

The browser cannot touch the USB scanner, so the button queues a row in
`fingerprint_captures` and the **Python service performs the capture**: three
presses of the same finger, checked against each other, merged into one template
that is saved on the student's row and loaded into the scanner straight away.
That means:

- `python backend/main.py` must be running with the scanner plugged in, or the
  button waits and eventually says the scanner never answered.
- Only one capture runs at a time; a second press while one is in flight waits
  its turn.
- Captures expire after 90 seconds, and finished rows are pruned hourly.

Prefer the command line, or working without the web app open? `python
backend/enroll.py` asks for the student's details first and then captures the
three prints, which is the same transaction in the other order.

## 7. Emails

Two senders, split by what the mail is. **Sign-in codes and registration
confirmations come from Supabase**, through its **Authentication → Emails →
SMTP** panel — that panel delivers auth mail only (sign-up confirmation, magic
link and password reset), and its built-in sender is capped at **2 messages per
hour**, which is why you configure custom SMTP in [§5](#registering-accounts).
Nothing there shares a credential with `backend/.env`.

**Parent notices come from the Python service**, because 300 arrivals in a
morning is a different problem from a code per session: it uses Brevo's API
(~300 emails a day free, no verified domain required, unlike Resend) rather than
Gmail's ~50-a-day cap.

## 8. Daily operation

```bash
python backend/main.py      # leave running on the machine with the scanner
cd frontend && npm run dev  # or: npm run build && npm run preview
```

Open `#/kiosk` full screen on the entrance monitor.

### Filters and printing

The professor's Students page narrows to what that teacher is assigned to: the
**Grade** filter lists their grades and the **Section** filter their sections
(every section in the class when their row is not narrowed to any), with a search
box and a live count over the table. **Print** opens the browser's print dialog
for whatever is on screen — the chrome, the filters and the row buttons drop out,
and the sheet gains a "Student records — 1st Year · Section B" heading with the
count and the date.

The Attendance dashboard prints the same way: today's log and the roster sit one
below the other rather than side by side, and **Print** drops the session timer,
the late rule card and the status dropdowns, leaving each student's status for the
day as plain text.

### Late rule per grade

Attendance is judged at the moment of the scan, and "late" is now a per-class
decision rather than one global switch. On the Attendance page, the **Late rule**
card sets the start time and grace minutes for a grade; a teacher sees only their
own class there, an admin can pick any.

The values land in `grade_settings`, and the Python service reads that grade's row
before stamping each scan — so a change applies to the next scan, with no restart.
With no row saved it falls back to `DEFAULT_START` and `DEFAULT_GRACE_MINUTES` in
`backend/service.py` (08:00 plus 15 minutes), which is also what the card prefills.
There is no `.env` setting for this any more; the late rule lives only in the
database.

**Reset today** clears the selected grade's scans since local midnight so a bad
morning can be started over. It asks for confirmation, it does not touch the
roster or yesterday's history, and parent emails already sent stay sent.

### Live updates

A scan appears on every open screen on its own. Supabase Realtime pushes
inserts, updates and deletes on `attendance_logs`, `students` and
`staff_profiles`, and each push reloads the roster and today's log. The
`UPDATE` matters as much as the insert: the backend writes the scan with
`parent_notified = false` and flips it a moment later, which is what moves the
Parent column from *Pending* to *Notified*.

Realtime is the fast path, not the only one — the same refresh also runs every
5 seconds, matching the backend's heartbeat, so a dropped socket, a backgrounded
tab or a sleeping laptop self-heals instead of freezing the entrance display. A
reset therefore cannot re-toast an old check-in: only a scan newer than the last
one seen raises the kiosk card.

---

### Troubleshooting

- **`relation "grade_settings" does not exist`** — re-run `schema.sql`. Scans are
  still logged using the `.env` default until you do.
- **`ZKFinger SDK not found`** — install the Windows Standard SDK, or set
  `ZKFP_DLL_PATH` to `libzkfp.dll`. A 32-bit Python cannot load the 64-bit DLL,
  so check `python -c "import sys; print(sys.maxsize > 2**32)"` says `True`.
- **`No scanner found (0 devices on this computer)`** — unplugged, or Windows has
  not enumerated it yet. Try another USB port and re-run `python main.py --status`.
- **Every scan says `Print not recognised`** — the scanner's memory was rebuilt
  from `students.fingerprint_template`, so anyone without a stored print there is
  unknown. Re-enroll them; the migration from the old sensor does not carry prints.
- **`TEMPLATES_DID_NOT_MATCH`** — two of the three enrollment scans were not the
  same finger. Lift the finger fully between presses and keep it still while each
  print is taken; a dry or oily panel also causes it — wipe it and press firmer.
- **Kiosk does not update** — `schema.sql` must have been run; it is what adds
  `attendance_logs` to the realtime publication.
- **`relation "students" does not exist`** — schema not applied yet.
- **Enroll form says `new row violates row-level security`** — sign in as staff first; a teacher may
  only enroll into the grade on their own staff row.
- **New staff stuck on `pending`** — the Python service is not running, or it started before you
  applied the new schema. Restart it.
- **Signed in but every screen says `Waiting for activation`** — your login exists in Supabase but
  has no `staff_profiles` row; an admin has to add you on the Staff page.
- **No email arrives** — `python main.py --status` prints which provider is
  active; `console` means no credentials were found.

## 9. Installing on another machine

`installer/` turns the whole thing into one setup file — the service, its own
copy of Python, the built web app, and your `backend/.env` keys — so the second
machine needs nothing installed first except the ZKFinger SDK.

```powershell
cd frontend   ; npm run build          # refresh the web app
cd ..\installer ; powershell -ExecutionPolicy Bypass -File .\build.ps1
```

`build.ps1` asks for a password, which is what encrypts the setup and everything
inside it. The result is `installer\Output\SmartAttendance-<version>-Setup.exe`;
copy that one file across. `installer\README.md` walks through the install on the
other computer, what to do when the console says it cannot see a scanner, and how
to rotate the keys if the file ever goes missing.

Two things to keep in mind. `installer\build\` holds a working copy of your
`.env` while you build, and `installer\password.ini` holds the setup password —
both are git-ignored, so keep them out of a commit. And the service-role key
inside that file bypasses every row-level rule, so the password is the only
thing between a copied setup file and full access to the database.
