# Smart Attendance System

Fingerprint attendance for a school entrance: a student scans a finger on an
Arduino Uno R3 + R307/AS608 sensor, the Python service logs the arrival in
Supabase, emails the parent, and the kiosk screen at the door updates itself.

```
Student finger ─► Arduino ─► Python backend ─► Supabase ─► Gmail/Brevo ─► Parent
                                   │              │
                                   │              └─ Realtime ─► React kiosk
                                   └─ heartbeat ─────────────► Dashboard status
```

| Folder | What lives there |
| --- | --- |
| `arduino/SmartAttendance/` | Uno firmware, speaks `FOUND_ID:<n>` over USB serial |
| `backend/` | Python service: serial reader, Supabase writer, email sender |
| `backend/schema.sql` | Tables, row-level security, realtime publication |
| `frontend/` | Vite + React app: kiosk, enrollment, dashboard, staff login |

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
| `ARDUINO_PORT` | e.g. `COM3` | scans come from the keyboard |
| `BREVO_API_KEY` | parent emails (~300/day free) | tries Resend, then Gmail |
| `RESEND_API_KEY` | emails (~100/day, needs a verified domain) | — |
| `GMAIL_ADDRESS` + `GMAIL_APP_PASSWORD` | Gmail SMTP (~50/day on a free account) | emails print to the console |
| `DUPLICATE_SCAN_MINUTES` | ignore a re-scan inside this window | default 45 |

Run it with `python main.py`. With no `ARDUINO_PORT` the console becomes the
scanner: type `1` to fake a scan, `e 4` to enrol, `x` for an unreadable print,
`q` to quit.

## 3. Arduino

1. Arduino IDE → **Library Manager** → install **Adafruit Fingerprint Library**.
2. Open `arduino/SmartAttendance/SmartAttendance.ino` and flash it.
3. Wiring (Uno R3 ↔ R307/AS608 module):

   | Sensor | Uno |
   | --- | --- |
   | VCC | 5V |
   | GND | GND |
   | TX | D2 |
   | RX | D3 |

   A stock AS608 talks at 9600 baud; an R307 at 57600. Change `SENSOR_BAUD` at
   the top of the sketch to match your module.
4. Add `ARDUINO_PORT=COM3` to `backend/.env` and start the backend again. The
   onboard LED flashes when a print is accepted.

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
| `#/teachers` | Teacher Management — assign grades, reveal passwords, and manage the whole student roster (add, edit, delete) |
| `#/attendance` | Attendance — today's log and search |
| `#/reports` | Reports — arrivals by day, today's split, students per grade, teachers by class size, parent notifications |

**Teacher**

| Route | Screen |
| --- | --- |
| `#/kiosk` | Live kiosk — the entrance display, first in the teacher menu |
| `#/home` | Dashboard — their grade's present, late and absent list |
| `#/students` | Students — roster table; **Add student** opens the form in a modal, scoped to their grade |
| `#/attendance` | Attendance — filtered to their grade by row-level security |

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
| **teacher** | read and enroll **their own grade only** | own grade | none |
| *anon* | read (this is what the public kiosk uses) | read | none |

The grade on a teacher's staff row is what scopes them, and it is enforced in
Postgres by row-level security — not just hidden in the UI — so a teacher
cannot read another class even by calling the API directly.

### Registering accounts

Switch email confirmation off first — **Studio → Authentication → Sign In / Up →
Email → uncheck "Confirm email"** — then open `#/register` and submit. A session
is returned immediately and the app signs you in as admin.

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
Management panel keeps the form inline. Either way, fill it in — including the
**Fingerprint ID**, which is the memory slot the sensor will use — and press
**Add student**. The row is saved first, and the modal then moves on to
**Enroll fingerprint**. Press it, then take the two prints: place the finger flat
and hold still, **lift it off completely**, and press the same finger again. The
print is stored in exactly the slot you named.

There is one modal, never two stacked: saving swaps the form for the capture step
in place.

Closing the modal (Escape, the ×, or **Do it later**) never discards the student —
the row is already saved. They just have no print yet, so scans will report
"not recognised" until you enroll them.

Saving before capturing is deliberate: if the finger is unreadable, timed out or
the backend is offline, the student still exists and you can press the button
again. The firmware is told which slot to use (`E:<id>` over serial) so the
sensor and the database can never disagree about an ID.

The browser cannot open the COM port, so the button queues a row in
`fingerprint_captures` and the **Python service performs the capture** on the
sensor. That means:

- `python backend/main.py` must be running with `ARDUINO_PORT` set, or the
  button waits and eventually says the sensor never answered.
- Only one capture runs at a time; a second press while one is in flight waits
  its turn.
- Captures expire after 75 seconds, and finished rows are pruned hourly.

Prefer the command line, or working without the web app open? `python
backend/enroll.py` captures a finger first and then asks for the student's
details, which is the same transaction in the other order.

## 7. Emails

Parent notices are sent by the **Python service**, not by Supabase. Supabase's
**Authentication → Emails → SMTP** panel only delivers auth emails (sign-up
confirmation, magic link, password reset), and its built-in mailer is capped at
**2 messages per hour** — fine for a login, useless for 300 morning arrivals.

Fill that panel in anyway if you want auth emails to come from the school
address. Use the same Gmail app password:

| Field | Value |
| --- | --- |
| Host | `smtp.gmail.com` |
| User | your Gmail address |
| Password | 16-character app password |
| Port | `587` |
| Sender email / name | the school address |

A Gmail app password comes from **myaccount.google.com → Security → 2-Step
Verification → App passwords** (a 2-step-verification account is required).
For anything above a handful of students use Brevo: free tier is ~300 emails a
day and it needs no verified domain, unlike Resend.

## 8. Daily operation

```bash
python backend/main.py      # leave running on the machine with the Arduino
cd frontend && npm run dev  # or: npm run build && npm run preview
```

Open `#/kiosk` full screen on the entrance monitor.

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
- **`[serial] Could not open COM3`** — the Arduino IDE Serial Monitor holds the
  port; close it. Check the port under Tools → Port.
- **`ERROR:SENSOR_NOT_RESPONDING`** — wrong `SENSOR_BAUD`, or TX/RX swapped.
- **`TEMPLATES_DID_NOT_MATCH`** — the two prints were not the same finger pose.
  Lift the finger fully between them and keep it still while each print is taken;
  a dry or oily sensor surface also causes it — wipe it and press a little firmer.
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
