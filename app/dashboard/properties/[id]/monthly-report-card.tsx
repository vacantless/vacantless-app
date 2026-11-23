// S831: the monthly report on the rental page. The report goes out by itself
// on the 1st (Every message we send); here the landlord writes the "next steps"
// note it carries and can send this month's report so far to themselves.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { saveReportNextSteps, sendReportToMe } from "./report-actions";

const RESULT: Record<string, { tone: "good" | "bad"; text: string }> = {
  sent: { tone: "good", text: "Sent to your email. Check your inbox." },
  note_saved: { tone: "good", text: "Next steps saved. The next report carries them." },
  send_failed: { tone: "bad", text: "The email did not go out. Try again in a minute." },
  no_email: { tone: "bad", text: "Your sign-in has no email address to send to." },
  error: { tone: "bad", text: "That did not save. Try again." },
  forbidden: { tone: "bad", text: "Only someone who can edit rentals can do this." },
};

export async function MonthlyReportCard({ propertyId, result }: { propertyId: string; result?: string }) {
  const supabase = createClient();
  const { data } = await supabase.from("properties").select("report_next_steps").eq("id", propertyId).maybeSingle();
  const note = (data as { report_next_steps?: string | null } | null)?.report_next_steps ?? "";
  const r = result ? RESULT[result] : undefined;
  return (
    <div id="monthly-report" className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">Monthly report</p>
      <p className="mt-1 text-xs text-gray-600">
        On the 1st of each month we email you a report on this rental. It shows renters, viewings, each site and what you
        spent. You can forward it to the owner as it is.{" "}
        <Link href="/dashboard/automations/every-message#rental_report_enabled" className="underline">
          Who gets it
        </Link>
      </p>
      {r && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${r.tone === "good" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
          {r.text}
        </p>
      )}
      <form action={saveReportNextSteps} className="mt-3">
        <input type="hidden" name="property_id" value={propertyId} />
        <label htmlFor="report-next-steps" className="text-xs font-medium text-gray-700">
          Next steps for the report
        </label>
        <textarea
          id="report-next-steps"
          name="next_steps"
          defaultValue={note}
          rows={3}
          maxLength={1000}
          placeholder="For example: postcards to the street next week."
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800">
          Save next steps
        </button>
      </form>
      <form action={sendReportToMe} className="mt-2">
        <input type="hidden" name="property_id" value={propertyId} />
        <button type="submit" className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">
          Send this month so far to me
        </button>
      </form>
    </div>
  );
}
