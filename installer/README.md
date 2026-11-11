# Shipping Smart Attendance to another computer

One file does the job: `Output\SmartAttendance-1.0.0-Setup.exe`. It carries the
one-file backend (`SmartAttendance.exe` — Python and all its code packed inside,
no black console window), the built web app, the ZKFinger SDK driver installer,
and your `backend\.env`, so the other machine needs no Node, no pip and no
Python installed. The setup asks for **no password**.

Heads-up that replaces the old password: the Brevo email key is baked into the
exe, and the `.env` inside the setup still holds the Supabase service-role key.
Anyone who gets a copy of the Setup file can extract both, so treat the file
like a house key: USB stick or direct hand-off, never a shared link.

---

## A. On this computer: build it

1. Refresh the web app, so the installer ships what you just changed:

   ```powershell
   cd C:\Projects\smartattendancesystem\frontend
   npm run build
   ```

2. Build the installer:

   ```powershell
   cd C:\Projects\smartattendancesystem\installer
   powershell -ExecutionPolicy Bypass -File .\build.ps1
   ```

   It runs PyInstaller over `backend\main.py` (one-file, no console window),
   stages the exe, the web app, `schema.sql`, your `.env` and the SDK setup
   under `build\`, then compiles. No prompts.

3. Finish with a line like `>> Ready: ...\Output\SmartAttendance-1.0.0-Setup.exe`.
   Copy that one file to a USB stick.

Prefer the Inno Setup window? Open `SmartAttendance.iss` and press **F9**; or
from PowerShell:

```powershell
& 'C:\Program Files\Inno Setup 7\ISCC.exe' C:\Projects\smartattendancesystem\installer\SmartAttendance.iss
```

---

## B. On the other computer: install it

1. Double-click `SmartAttendance-...-Setup.exe` and accept the defaults. Leave
   **Install the ZKFinger SDK driver** ticked — the driver ships inside this
   setup now and installs itself silently. Tick **Create a desktop shortcut**
   if you want one.
2. Tick **Start the scanner service when this user signs in** only if this
   machine is the one that will be left on at the school gate. A shortcut then
   lands in the Startup folder and the service launches silently at sign-in.
3. Plug the Live20R in and let Windows finish recognising it. If the SDK did
   not install, restart the computer first.
4. Start **Smart Attendance**. Your browser opens <http://localhost:8766>. Sign
   in with the same account you use here.

There is no console window any more. What the service would have printed goes
to `C:\Users\Public\SmartAttendance\service.log` — worth reading once on the new
machine to see which database it reached and how many scanners the SDK can see.

---

## What ends up on that machine

```
C:\Program Files\SmartAttendance\
  SmartAttendance.exe       the whole backend, Python included
  web\                      the built web app the browser opens
  vendor\ZKFingerSDK_setup.exe   the driver installer, kept in case of reinstall
  .env                      Supabase mirror settings (the email key is inside the exe)
  schema.sql               for re-running in Supabase Studio if you edit it
C:\Users\Public\SmartAttendance\
  attendance.db             every scan, offline first; service.log sits beside it
```

To change the Supabase settings later, edit `.env` — Notepad has to be run **as
administrator** for that folder — then restart the service.

---

## Two machines, one database

Scans land in the local `attendance.db` first, so the gate keeps working with
the internet unplugged; parent emails queue as PENDING and go out on their own
once the network returns. When a Supabase `.env` is present, the same worker
also mirrors scans up and pulls the roster down every 30 seconds, so a student
enrolled on one machine works on the other after the next resync.

---

## If it goes wrong

| You see | What to do |
| --- | --- |
| Windows says "protected your PC" | Click **More info** → **Run anyway**. It is unsigned, so this is expected. |
| "The ZKFinger SDK driver is still not on this computer" | Run `C:\Program Files\SmartAttendance\vendor\ZKFingerSDK_setup.exe` by hand, restart, then start the service. |
| `service.log` says `0 USB scanner(s) visible` | Try another USB port, and check Device Manager for the Live20R. |
| Browser opens a blank page | The web app was not staged. Run `npm run build` in `frontend`, then rebuild the installer. |
| Antivirus deleted `SmartAttendance.exe` | Restore it and exclude `C:\Program Files\SmartAttendance`. PyInstaller exes are frequent false positives. |
| Port 8766 is taken | Set `WEB_PORT` in `.env` and restart. |
| Parent emails do not arrive | `service.log` shows what the queue is doing; check `--status` output in the same log. |

To ask the exe how it is configured without starting the scanner loop, run
`SmartAttendance.exe --status` from PowerShell and read the fresh lines in
`service.log`.

---

## About the keys you are shipping

The service-role key in `.env` can read and write every row in the database,
past all the role rules, and the Brevo key sits inside the exe. So:

- Do not email the setup file around, and do not leave it on a shared drive.
- If it goes missing, rotate both keys: Supabase **Project Settings → API** for
  the service-role key, and Brevo **SMTP & API** for the email key — then
  rebuild the installer so the new Brevo key is baked in.
- `installer\build\` keeps a working copy of your `.env` while you build. It is
  git-ignored; leave it that way. `backend\dist\` holds the exe, and it is
  git-ignored for the same reason.
- Inno Setup's compiler banner reads "Non-commercial use only" — check its
  licence terms before selling copies of this.
