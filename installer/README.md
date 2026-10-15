# Shipping Smart Attendance to another computer

One file does the job: `Output\SmartAttendance-1.0.0-Setup.exe`. It carries the
service, its own copy of Python, the built web app, and your `backend\.env`
keys, so the other machine needs no Node, no pip and no Python installed.

The setup itself is encrypted. Whoever installs it types the password you chose
when building it, and without that password the files inside — including your
keys — cannot be read.

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

   It asks for a password twice. Pick one you will remember or write down — you
   type it on the *other* machine during install. It then downloads a small
   embeddable Python (cached in `vendor\`), installs `httpx` and
   `python-dotenv` into it, stages everything under `build\`, and compiles.

3. Finish with a line like `>> Ready: ...\Output\SmartAttendance-1.0.0-Setup.exe`.
   Copy that one file to a USB stick.

Prefer the Inno Setup window? It cannot ask you for a password, so give it one to
read first: copy `password.ini.example` to `password.ini` in this folder, put
your password on the `password=` line, save, then open `SmartAttendance.iss` and
press **F9**. `password.ini` is git-ignored, and once `build.ps1` has run once it
writes that file for you.

The other way, if you would rather not keep it in a file, is to launch the
compiler from PowerShell with the variable set:

```powershell
$env:SETUP_PASSWORD = 'your password'
& 'C:\Program Files\Inno Setup 7\ISCC.exe' C:\Projects\smartattendancesystem\installer\SmartAttendance.iss
```

With neither, the compile stops on purpose rather than quietly shipping your keys
unencrypted:

> No installer password. Either run build.ps1, or copy password.ini.example to
> password.ini in this folder and set password=your password on the second line.


---

## B. On the other computer: install it

1. **Install the ZKFinger SDK first**, from ZKTeco, the 64-bit "ZKFinger SDK
   (Windows Standard)". It cannot be bundled here because it installs its own
   driver. If it is missing the installer tells you when it finishes.
2. Double-click `SmartAttendance-...-Setup.exe`, enter the password, and accept
   the defaults. Tick **Create a desktop shortcut** if you want one.
3. Tick **Start the scanner service when this user signs in** only if this
   machine is the one that will be left on at the school gate. If you do, use
   that *instead of* the shortcut, not both — two services would fight over the
   scanner.
4. Plug the Live20R in and let Windows finish recognising it.
5. Start **Smart Attendance**. A console window opens with what it found, and
   your browser opens <http://localhost:8766>. Sign in with the same account you
   use here.

The console is worth reading once: it says which database it reached and how
many scanners the SDK can see.

---

## What ends up on that machine

```
C:\Program Files\SmartAttendance\
  runtime\python.exe        the private Python the service runs on
  app\backend\              the service, plus your .env with the keys
  app\web\                  the built web app the console opens
```

To change a key later, edit `app\backend\.env` — Notepad has to be run **as
administrator** for that folder — then restart the service.

---

## Two machines, one database

Both computers talk to the same Supabase project, so a student enrolled on one
appears on the other, and the roster is shared. The machine with the scanner
must be running for a fingerprint to be read; any other computer only needs a
browser pointed at *its own* copy or at the hosted one.

---

## If it goes wrong

| You see | What to do |
| --- | --- |
| Windows says "protected your PC" | Click **More info** → **Run anyway**. It is unsigned, so this is expected. |
| "ZKFinger SDK was not found" | Install the SDK, restart the computer, then start the service again. |
| Console says `0 USB scanner(s) visible` | Try another USB port, and check Device Manager for the Live20R. `python app\backend\main.py --probe 30` watches it answer presses. |
| Browser opens a blank page | The web app was not staged. Run `npm run build` in `frontend`, then rebuild the installer. |
| Antivirus deleted `python.exe` | Restore it and exclude `C:\Program Files\SmartAttendance`. |
| Port 8766 is taken | Set `WEB_PORT` in `app\backend\.env` and restart. |
| A reinstall asks for a password you no longer have | There is no recovery; build a new installer with a password you keep. |

---

## About the keys you are shipping

The service-role key in `.env` can read and write every row in the database,
past all the role rules. The installer password keeps casual copying out, but
anyone who has both the file and the password holds full access. So:

- Do not email the setup file around, and do not leave it on a shared drive.
- If it goes missing, rotate both keys: Supabase **Project Settings → API** for
  the service-role key, and Brevo **SMTP & API** for the email key. Then rebuild.
- `installer\build\` keeps a working copy of your `.env` while you build. It is
  git-ignored; leave it that way.
- Inno Setup's compiler banner reads "Non-commercial use only" — check its
  licence terms before selling copies of this.
