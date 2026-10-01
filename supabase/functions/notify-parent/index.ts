/**
 * Supabase Edge Function: notify-parent
 *
 * Called by the frontend when a teacher manually marks a student's attendance.
 * Sends a parent notification email via Brevo and updates the attendance row's
 * parent_notified flag in the database.
 *
 * Deploy:
 *   supabase functions deploy notify-parent
 *
 * Required secrets (set once per project):
 *   supabase secrets set BREVO_API_KEY=<your-key>
 *   supabase secrets set EMAIL_SENDER_ADDRESS=school@example.com
 *   supabase secrets set EMAIL_SENDER_NAME="School Attendance"
 *
 * Request body (JSON):
 *   {
 *     "log_id":    "<attendance_log uuid>",
 *     "student":   { first_name, last_name, grade_level, parent_email },
 *     "status":    "Present" | "Late" | "Absent",
 *     "scan_time": "<ISO timestamp>",
 *     "marked_by": "Teacher Name"   // optional
 *   }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

const STATUS_STYLES: Record<string, { bg: string; fg: string }> = {
  Present: { bg: "#e6f4ec", fg: "#127a43" },
  Late:    { bg: "#fbf0dd", fg: "#9a5b00" },
  Absent:  { bg: "#fde8e8", fg: "#b91c1c" },
};

const STATUS_VERBS: Record<string, string> = {
  Present: "marked present",
  Late:    "marked late",
  Absent:  "marked absent",
};

function buildHtml(name: string, grade: string, timeStr: string, byLine: string, status: string): string {
  const { bg, fg } = STATUS_STYLES[status] ?? { bg: "#f0f0f0", fg: "#444" };
  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:36px 24px;color:#14161a">
  <p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#8b929b">Smart Attendance — Manual Record</p>
  <h1 style="font-size:26px;margin:14px 0 6px;letter-spacing:-.02em">Attendance update for ${name}</h1>
  <p style="color:#4b5158;margin:0">Grade: ${grade || "—"}</p>
  <p style="color:#4b5158;margin:6px 0 4px">Time recorded: ${timeStr}</p>
  <p style="color:#4b5158;margin:0 0 22px">Recorded${byLine} by school staff.</p>
  <p style="display:inline-block;font-size:13px;font-weight:600;letter-spacing:.12em;padding:8px 18px;border-radius:999px;background:${bg};color:${fg}">${status.toUpperCase()}</p>
  <p style="margin-top:26px;font-size:12px;color:#8b929b">If you believe this is an error, please contact the school directly.</p>
</div>`.trim();
}

function buildText(name: string, grade: string, statusVerb: string, byLine: string, timeStr: string): string {
  return [
    "Dear Parent/Guardian,",
    "",
    `Your child ${name}${grade ? ` (${grade})` : ""} was ${statusVerb}${byLine} at ${timeStr} today.`,
    "",
    "If you have questions, please contact the school.",
    "",
    "Sent automatically by the school attendance system.",
  ].join("\n");
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const brevoKey = Deno.env.get("BREVO_API_KEY");
  const senderAddress = Deno.env.get("EMAIL_SENDER_ADDRESS") ?? "";
  const senderName = Deno.env.get("EMAIL_SENDER_NAME") ?? "School Attendance";

  if (!brevoKey || !senderAddress) {
    return new Response(
      JSON.stringify({ error: "Email not configured. Set BREVO_API_KEY and EMAIL_SENDER_ADDRESS secrets." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: {
    log_id?: string;
    student?: { first_name?: string; last_name?: string; grade_level?: string; parent_email?: string };
    status?: string;
    scan_time?: string;
    marked_by?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { log_id, student, status = "Present", scan_time, marked_by = "" } = body;

  if (!student?.parent_email) {
    return new Response(JSON.stringify({ error: "Student has no parent_email." }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const name = `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim();
  const grade = student.grade_level ?? "";
  const timeStr = scan_time ? formatTime(scan_time) : "—";
  const byLine = marked_by ? ` by ${marked_by}` : "";
  const statusVerb = STATUS_VERBS[status] ?? `marked as ${status.toLowerCase()}`;

  const subject = `Attendance update for ${name} — ${status}`;
  const html = buildHtml(name, grade, timeStr, byLine, status);
  const text = buildText(name, grade, statusVerb, byLine, timeStr);

  // Send via Brevo
  const brevoResp = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      "api-key": brevoKey,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderAddress },
      to: [{ email: student.parent_email, name }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!brevoResp.ok) {
    const errText = await brevoResp.text();
    console.error("[notify-parent] Brevo error:", errText);
    return new Response(JSON.stringify({ error: `Brevo rejected the request: ${errText}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Update the attendance log's parent_notified flag if a log_id was provided
  if (log_id) {
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      await supabase
        .from("attendance_logs")
        .update({ parent_notified: true })
        .eq("id", log_id);
    } catch (dbErr) {
      // Non-fatal: the email was sent; just log the DB failure
      console.warn("[notify-parent] Could not update parent_notified flag:", dbErr);
    }
  }

  console.log(`[notify-parent] Notified ${name} -> ${student.parent_email} (${status})`);
  return new Response(JSON.stringify({ sent: true, to: student.parent_email }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
