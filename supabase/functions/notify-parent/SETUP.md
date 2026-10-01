# notify-parent — Supabase Edge Function

Sends a parent notification email via **Brevo** when a teacher manually marks a student's attendance, then flips `parent_notified = true` on the attendance log row.

## Deploy

```bash
# One-time: install the Supabase CLI if not already installed
npm install -g supabase

# Login
supabase login

# Link to your project (get the project ref from your Supabase dashboard URL)
supabase link --project-ref rqyfeixkgyjkhplmuger

# Set the required secrets (only needs to be done once)
supabase secrets set BREVO_API_KEY=<your-brevo-api-key>
supabase secrets set EMAIL_SENDER_ADDRESS=<your-sender-email>
supabase secrets set EMAIL_SENDER_NAME="School Attendance"

# Deploy the function
supabase functions deploy notify-parent
```

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the Supabase runtime — you don't need to set them manually.

## How it works

1. Teacher clicks **Present / Late / Absent** on a student row in the Teacher Dashboard.
2. The frontend calls `api.markAttendance()` → inserts a row into `attendance_logs`.
3. The frontend calls `api.notifyParent()` → POSTs to this Edge Function.
4. The Edge Function sends a Brevo transactional email to the student's `parent_email`.
5. The Edge Function patches `attendance_logs.parent_notified = true`.
6. The frontend's realtime subscription picks up the change and the dashboard refreshes.

## Request body

```json
{
  "log_id":    "<attendance_log uuid>",
  "student":   {
    "first_name": "Ana",
    "last_name":  "Reyes",
    "grade_level": "Grade 5",
    "parent_email": "parent@example.com"
  },
  "status":    "Present",
  "scan_time": "2026-10-01T08:05:00+08:00",
  "marked_by": "Teacher Name"
}
```

## Testing locally

```bash
supabase functions serve notify-parent --env-file ../backend/.env

curl -X POST http://localhost:54321/functions/v1/notify-parent \
  -H "Content-Type: application/json" \
  -d '{
    "student": {
      "first_name": "Ana",
      "last_name": "Reyes",
      "grade_level": "Grade 5",
      "parent_email": "your-test-email@gmail.com"
    },
    "status": "Present",
    "scan_time": "2026-10-01T08:05:00+08:00",
    "marked_by": "Test Teacher"
  }'
```
