import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { statusLabel, type LeadStatus } from "@/lib/pipeline";
import { incomeRequirementMagnitude } from "@/lib/screening";
import {
  collectPreferenceMismatches,
  preferredAnswerLabel,
  type CustomAnswerSnapshot,
} from "@/lib/screening-questions";
import {
  resolveLeadSource,
  followUpStatus,
  followUpLabel,
  suggestedNextStageOptions,
  canOfferEarlyTenancy,
  type FollowUpStatus,
} from "@/lib/lead-detail";
import { PageHeader, SectionHeading, EmptyState } from "@/components/ui";
import { Icons } from "@/components/icons";
import { StatusSelect } from "../status-select";
import {
  addNote,
  setNextAction,
  clearNextAction,
  updateLeadStatus,
  requestRentalApplication,
} from "../actions";
import { canUseRentalApplications } from "@/lib/billing";
import { OutcomeSelect } from "../../showings/outcome-select";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

export const dynamic = "force-dynamic";

/** Whole-dollar money for the operator's screening context (e.g. "$8,400"). */
function money(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-CA");
}

type ListingPost = {
  portal: string | null;
  label: string | null;
  url: string | null;
} | null;

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  source_detail: string | null;
  status: LeadStatus;
  notes: string | null;
  move_in: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  created_at: string;
  screen_income_cents: number | null;
  screen_occupants: number | null;
  screen_has_pets: boolean | null;
  screen_pets_detail: string | null;
  qualified_out: boolean;
  qualify_out_reasons: string[] | null;
  screen_custom_answers: CustomAnswerSnapshot[] | null;
  property: { id: string; address: string; rent_cents: number | null } | null;
  listing_post: ListingPost;
};

type Message = {
  id: string;
  channel: string | null;
  direction: string | null;
  body: string | null;
  created_at: string;
};

type Showing = {
  id: string;
  scheduled_at: string | null;
  outcome: string;
};

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { apply?: string };
}) {
  const supabase = createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select(
      "id, name, email, phone, source, source_detail, status, notes, move_in, next_action_at, next_action_note, created_at, screen_income_cents, screen_occupants, screen_has_pets, screen_pets_detail, qualified_out, qualify_out_reasons, screen_custom_answers, property:properties(id, address, rent_cents), listing_post:listing_posts(portal, label, url)",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!lead) notFound();
  const l = lead as unknown as Lead;

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, channel, direction, body, created_at")
    .eq("lead_id", l.id)
    .order("created_at", { ascending: false });
  const messages = (msgs ?? []) as Message[];

  const { data: showingData } = await supabase
    .from("showings")
    .select("id, scheduled_at, outcome")
    .eq("lead_id", l.id)
    .order("scheduled_at", { ascending: false });
  const showings = (showingData ?? []) as Showing[];

  // Rental application on this lead (S454, Slice 1). Latest by request time; there
  // is at most one OPEN application (requestRentalApplication guards duplicates).
  const { data: appRow } = await supabase
    .from("rental_applications")
    .select(
      "id, status, public_token, pay_mode, applicant_name, submitted_at, requested_at, form_data",
    )
    .eq("lead_id", l.id)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const application = appRow as RentalApp | null;

  // Cancelled-booking cue (S447 Codex P3): a lead can sit at "Booked" after its
  // only viewing was cancelled - the cancel path deliberately leaves the stage to
  // the operator, so surface it clearly rather than let "Booked" read as an active
  // booking. Active viewing == still 'scheduled' (not cancelled/attended/no_show).
  const hasScheduledShowing = showings.some((s) => s.outcome === "scheduled");
  const hasCancelledShowing = showings.some((s) => s.outcome === "cancelled");
  const bookedWithNoActiveViewing =
    l.status === "booked" && !hasScheduledShowing && hasCancelledShowing;

  // A leased lead can be converted into a tenancy (the property-management
  // record). If one already exists for this lead, link to it instead of
  // offering to create a duplicate.
  const { data: tenancyRef } = await supabase
    .from("tenancies")
    .select("id")
    .eq("lead_id", l.id)
    .maybeSingle();
  const existingTenancyId = (tenancyRef as { id: string } | null)?.id ?? null;

  const org = await getCurrentOrg();
  const timeZone = org?.booking_timezone ?? "America/Toronto";
  const canApplications = canUseRentalApplications(org?.plan);
  const applyBannerKey = searchParams.apply ?? null;
  // "Today" in the org's timezone as YYYY-MM-DD (en-CA formats that way).
  const today = new Date().toLocaleDateString("en-CA", { timeZone });

  const sourceDisplay = resolveLeadSource({
    source: l.source,
    source_detail: l.source_detail,
    post: l.listing_post,
  });
  const followStatus = followUpStatus(l.next_action_at, today);
  const followText = followUpLabel(l.next_action_at, today);
  const quickStages = suggestedNextStageOptions(l.status);

  // Operator-only income magnitude for the qualify-out flag (S258): how far the
  // renter's reported income sits from THIS org's requirement (multiple x rent).
  // Computed live from current criteria + current rent; the reported figure is
  // the intake snapshot. Never rendered on a renter-facing surface, so the
  // private multiple stays private. Null when income screening is off/unconfigured
  // or the lead/rental lacks the figures.
  const incomeMagnitude = org?.screening_enabled
    ? incomeRequirementMagnitude(
        l.screen_income_cents,
        l.property?.rent_cents,
        org.screening_income_multiple,
      )
    : null;

  // Custom preferred-answer mismatches (S293). A SOFT, purely informational
  // heads-up — kept entirely separate from qualified_out so an operator-authored
  // question can never auto-disqualify. Silent for every pre-S293 lead and every
  // no-preference question (collectPreferenceMismatches returns []).
  const preferenceMismatches = collectPreferenceMismatches(l.screen_custom_answers);

  return (
    <div>
      <Link
        href="/dashboard/leads"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        ← Inquiries
      </Link>

      <PageHeader
        icon={<Icons.users />}
        title={l.name || l.email || "Unnamed renter"}
        subtitle={
          <>
            Received {new Date(l.created_at).toLocaleString("en-US", { timeZone })}
            {sourceDisplay ? (
              <>
                {" · via "}
                {sourceDisplay.url ? (
                  <a
                    href={sourceDisplay.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand hover:underline"
                  >
                    {sourceDisplay.label}
                  </a>
                ) : (
                  <span className="font-medium text-gray-600">
                    {sourceDisplay.label}
                  </span>
                )}
              </>
            ) : null}
          </>
        }
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-gray-400">
              Stage
            </span>
            <StatusSelect leadId={l.id} status={l.status} />
          </div>
        }
      />

      {bookedWithNoActiveViewing && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <strong>The booked viewing was cancelled.</strong> This lead is still
          marked <span className="font-semibold">Booked</span> but has no active
          viewing - rebook a time or move the stage so the pipeline stays accurate.
        </p>
      )}

      {/* Quick stage moves — one click to the likely next stages. */}
      {quickStages.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-gray-400">
            Quick move
          </span>
          {quickStages.map((q) => (
            <form key={q.stage} action={updateLeadStatus}>
              <input type="hidden" name="id" value={l.id} />
              <input type="hidden" name="status" value={q.stage} />
              <button
                type="submit"
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                  q.stage === "lost"
                    ? "border-gray-300 bg-white text-gray-500 hover:bg-gray-50"
                    : "border-brand/30 bg-brand/5 text-brand hover:bg-brand/10"
                }`}
              >
                {q.stage === "new" ? "Reopen" : `→ ${q.label}`}
              </button>
            </form>
          ))}
        </div>
      )}

      {/* Pre-screening flag. A SOFT signal — the lead is never hidden; the
          operator decides. Reasons are the snapshot stored at intake. */}
      {l.qualified_out && (l.qualify_out_reasons?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              Possible mismatch
            </span>
            <span className="text-xs text-gray-500">
              Based on your screening criteria — review before deciding.
            </span>
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
            {l.qualify_out_reasons!.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {/* Income magnitude (S258): how far off, not just that it's off.
              Operator-only context computed from current criteria. */}
          {incomeMagnitude && (
            <p className="mt-2 border-t border-amber-200 pt-2 text-sm text-amber-900">
              {incomeMagnitude.meetsRequirement ? (
                <>
                  Reported income{" "}
                  <span className="font-semibold">
                    {money(incomeMagnitude.reportedCents)}/mo
                  </span>{" "}
                  meets your {incomeMagnitude.multiple}× guideline (~
                  {money(incomeMagnitude.requiredCents)}/mo).
                </>
              ) : (
                <>
                  Reported income{" "}
                  <span className="font-semibold">
                    {money(incomeMagnitude.reportedCents)}/mo
                  </span>
                  {" — "}
                  <span className="font-semibold">
                    {money(incomeMagnitude.shortfallCents)}/mo below
                  </span>{" "}
                  your {incomeMagnitude.multiple}× guideline (~
                  {money(incomeMagnitude.requiredCents)}/mo).
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* Preferred-answer heads-up (S293). DELIBERATELY separate from the
          qualify-out panel above and styled blue (informational), not amber
          (criteria flag): a custom question's preferred answer never feeds
          qualified_out and never hides a lead. Shown only when the operator set
          a preference and the renter's answer differs. */}
      {preferenceMismatches.length > 0 && (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
              Worth a look
            </span>
            <span className="text-xs text-gray-500">
              Doesn&apos;t match a preference you set — just a heads-up, not a flag.
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-sky-900">
            {preferenceMismatches.map((a) => (
              <li key={a.question_id}>
                <span className="font-medium">{a.prompt}</span> — answered{" "}
                <span className="font-semibold">
                  {a.answer === "yes" ? "Yes" : "No"}
                </span>{" "}
                <span className="text-sky-700">
                  (you {preferredAnswerLabel(a.preferred ?? null).toLowerCase()})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Follow-up reminder. */}
      <FollowUp
        leadId={l.id}
        status={followStatus}
        text={followText}
        date={l.next_action_at}
        note={l.next_action_note}
      />

      {/* Convert-to-tenancy bridge: a signed renter moves from the leasing side
          to the property-management side.
          - A tenancy already on file → dedupe to "View tenancy" (any stage).
          - Leased with no tenancy yet → the primary "Convert to tenancy" bridge.
          - A viable OPEN lead (booked/showed/applied) → a lighter "Ready to
            lease?" affordance so the landlord who signed outside the app doesn't
            have to find the stage dropdown first (post-S402 pilot friction). */}
      {existingTenancyId ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-brand/5 px-4 py-3">
          <p className="text-sm text-gray-700">
            This renter has a tenancy on file.
          </p>
          <Link
            href={`/dashboard/tenancies/${existingTenancyId}`}
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View tenancy →
          </Link>
        </div>
      ) : l.status === "leased" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-brand/5 px-4 py-3">
          <p className="text-sm text-gray-700">
            Lease signed? Create the tenancy record to manage rent and tenant
            messaging.
          </p>
          <Link
            href={`/dashboard/tenancies/new?from=${l.id}`}
            className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Convert to tenancy
          </Link>
        </div>
      ) : canOfferEarlyTenancy(l.status) ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-sm text-gray-700">
            <span className="font-medium">Ready to lease this renter?</span> You
            can create the tenancy now — we&apos;ll mark this inquiry Leased.
          </p>
          <Link
            href={`/dashboard/tenancies/new?from=${l.id}`}
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Create tenancy
          </Link>
        </div>
      ) : null}

      <ApplicationCard
        leadId={l.id}
        application={application}
        canApplications={canApplications}
        applyBaseUrl={APP_URL}
        timeZone={timeZone}
        bannerKey={applyBannerKey}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Email"
          value={l.email}
          href={l.email ? `mailto:${l.email}` : undefined}
          external
        />
        <Field
          label="Phone"
          value={l.phone}
          href={l.phone ? `tel:${l.phone}` : undefined}
          external
        />
        <Field
          label="Rental"
          value={l.property?.address ?? null}
          href={
            l.property ? `/dashboard/properties/${l.property.id}` : undefined
          }
        />
        <Field
          label="Desired move-in"
          value={l.move_in ? new Date(l.move_in).toLocaleDateString("en-CA", { timeZone: "UTC" }) : null}
        />
        {l.screen_income_cents != null && (
          <Field
            label="Stated monthly income"
            value={`$${(l.screen_income_cents / 100).toLocaleString("en-CA")}`}
          />
        )}
        {l.screen_occupants != null && (
          <Field label="Occupants" value={String(l.screen_occupants)} />
        )}
        {(l.screen_has_pets != null || l.screen_pets_detail) && (
          <Field
            label="Pets"
            value={
              l.screen_pets_detail
                ? l.screen_pets_detail
                : l.screen_has_pets
                  ? "Yes"
                  : "No"
            }
          />
        )}
        {(l.screen_custom_answers ?? []).map((a) => (
          <Field
            key={a.question_id}
            label={a.prompt}
            value={a.qtype === "yesno" ? (a.answer === "yes" ? "Yes" : "No") : a.answer}
          />
        ))}
      </div>

      {l.notes && (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
            Inquiry message
          </h3>
          <p className="whitespace-pre-wrap text-sm text-gray-700">{l.notes}</p>
        </div>
      )}

      {showings.length > 0 && (
        <>
          <div className="mt-8">
            <SectionHeading>Viewings</SectionHeading>
          </div>
          <ul className="space-y-2">
            {showings.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
              >
                <span className="text-sm font-medium text-gray-900">
                  {s.scheduled_at
                    ? new Date(s.scheduled_at).toLocaleString("en-US", {
                        timeZone,
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })
                    : "Time TBD"}
                </span>
                <OutcomeSelect showingId={s.id} outcome={s.outcome} />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-8">
        <SectionHeading>Activity</SectionHeading>
      </div>

      <form
        action={addNote}
        className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <input type="hidden" name="id" value={l.id} />
        <textarea
          name="body"
          rows={2}
          required
          placeholder="Log a call, an email you sent, or a note…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 text-right">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            Add note
          </button>
        </div>
      </form>

      {messages.length === 0 ? (
        <EmptyState
          icon={<Icons.chat />}
          title="No activity yet"
          description="Log a call, email, or note using the form above."
        />
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
                <span className="font-medium uppercase tracking-wider">
                  {m.channel ?? "note"}
                </span>
                <span>·</span>
                <span>{m.direction ?? ""}</span>
                <span>·</span>
                <span>{new Date(m.created_at).toLocaleString("en-US", { timeZone })}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                {m.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FOLLOW_STYLES: Record<
  Exclude<FollowUpStatus, "none">,
  { wrap: string; chip: string }
> = {
  overdue: {
    wrap: "border-red-200 bg-red-50",
    chip: "bg-red-100 text-red-700",
  },
  today: {
    wrap: "border-amber-200 bg-amber-50",
    chip: "bg-amber-100 text-amber-700",
  },
  upcoming: {
    wrap: "border-gray-200 bg-white",
    chip: "bg-gray-100 text-gray-600",
  },
};

function FollowUp({
  leadId,
  status,
  text,
  date,
  note,
}: {
  leadId: string;
  status: FollowUpStatus;
  text: string;
  date: string | null;
  note: string | null;
}) {
  const isSet = status !== "none";
  const styles = isSet ? FOLLOW_STYLES[status] : FOLLOW_STYLES.upcoming;

  return (
    <div className={`mt-4 rounded-2xl border p-4 shadow-sm ${styles.wrap}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Follow-up
          </span>
          {isSet ? (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles.chip}`}
            >
              {text}
            </span>
          ) : (
            <span className="text-sm text-gray-400">None scheduled</span>
          )}
        </div>
        {isSet && (
          <form action={clearNextAction}>
            <input type="hidden" name="id" value={leadId} />
            <button
              type="submit"
              className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
            >
              Mark done
            </button>
          </form>
        )}
      </div>

      {isSet && note && (
        <p className="mt-2 text-sm text-gray-700">{note}</p>
      )}

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium text-brand">
          {isSet ? "Edit follow-up" : "Schedule a follow-up"}
        </summary>
        <form action={setNextAction} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={leadId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">
                Follow up on
              </span>
              <input
                type="date"
                name="next_action_at"
                defaultValue={date ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">
                Note (optional)
              </span>
              <input
                type="text"
                name="next_action_note"
                defaultValue={note ?? ""}
                placeholder="Call about parking…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="text-right">
            <button
              type="submit"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              Save follow-up
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

function Field({
  label,
  value,
  href,
  external,
}: {
  label: string;
  value: string | null;
  href?: string;
  external?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-gray-900">
        {value ? (
          href ? (
            external ? (
              <a href={href} className="text-brand hover:underline">
                {value}
              </a>
            ) : (
              <Link href={href} className="text-brand hover:underline">
                {value}
              </Link>
            )
          ) : (
            value
          )
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </div>
    </div>
  );
}

// --- Rental application (S454, Slice 1) ------------------------------------

type RentalApp = {
  id: string;
  status: string;
  public_token: string;
  pay_mode: string;
  applicant_name: string | null;
  submitted_at: string | null;
  requested_at: string | null;
  form_data: Record<string, unknown> | null;
};

// Human labels for the non-sensitive Form-410-equivalent keys (mirror
// lib/rental-application ALLOWED_FORM_FIELDS). Used to render the submission.
const FORM_LABELS: Record<string, string> = {
  current_address: "Current address",
  current_duration: "Time at current address",
  current_rent: "Current monthly rent",
  current_landlord_name: "Current landlord",
  current_landlord_contact: "Current landlord contact",
  current_reason_leaving: "Reason for leaving",
  previous_address: "Previous address",
  previous_duration: "Time at previous address",
  previous_landlord_name: "Previous landlord",
  previous_landlord_contact: "Previous landlord contact",
  employer: "Employer",
  position: "Position",
  employment_length: "Length of employment",
  supervisor_contact: "Supervisor / HR contact",
  gross_income: "Gross monthly income",
  second_employer: "Second employer",
  second_income: "Second income",
  other_income: "Other income",
  bank_reference_institution: "Bank / institution",
  reference_1_name: "Reference 1",
  reference_1_contact: "Reference 1 contact",
  reference_2_name: "Reference 2",
  reference_2_contact: "Reference 2 contact",
  vehicles: "Vehicle(s)",
  occupants: "Other occupants",
  smoking: "Smoking",
  pets: "Pets",
  emergency_contact_name: "Emergency contact",
  emergency_contact_phone: "Emergency contact phone",
};

const APPLY_BANNERS: Record<string, { tone: "ok" | "warn" | "err"; text: string }> = {
  sent: { tone: "ok", text: "Application link sent to the applicant." },
  exists: { tone: "warn", text: "An application is already open for this lead." },
  error: { tone: "err", text: "Couldn't create the application. Please try again." },
  upgrade: { tone: "warn", text: "Rental applications are a Growth feature. Upgrade to request one." },
};

function ApplicationCard({
  leadId,
  application,
  canApplications,
  applyBaseUrl,
  timeZone,
  bannerKey,
}: {
  leadId: string;
  application: RentalApp | null;
  canApplications: boolean;
  applyBaseUrl: string;
  timeZone: string;
  bannerKey: string | null;
}) {
  const banner = bannerKey ? APPLY_BANNERS[bannerKey] ?? null : null;
  const bannerClass =
    banner?.tone === "ok"
      ? "border-green-200 bg-green-50 text-green-800"
      : banner?.tone === "err"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-amber-200 bg-amber-50 text-amber-800";

  const submitted = application != null && application.status !== "requested";
  const entries = submitted
    ? Object.entries(application?.form_data ?? {}).filter(
        ([, v]) => v != null && String(v).trim().length > 0,
      )
    : [];

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      {banner && (
        <p className={`mb-3 rounded-lg border px-3 py-2 text-sm ${bannerClass}`}>
          {banner.text}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Rental application
        </h3>
        {application && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              submitted ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {submitted ? "Submitted" : "Awaiting applicant"}
          </span>
        )}
      </div>

      {application ? (
        submitted ? (
          <div className="mt-3">
            <p className="text-sm text-gray-600">
              Submitted
              {application.submitted_at
                ? ` ${new Date(application.submitted_at).toLocaleString("en-US", { timeZone })}`
                : ""}
              {" · "}
              {application.pay_mode === "landlord" ? "landlord-paid" : "applicant-paid"}.
            </p>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-medium text-brand">
                View submission
              </summary>
              {entries.length > 0 ? (
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {entries.map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">
                        {FORM_LABELS[k] ?? k}
                      </dt>
                      <dd className="whitespace-pre-wrap text-sm text-gray-800">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-gray-500">
                  The applicant submitted the consent without filling optional fields.
                </p>
              )}
            </details>
            <p className="mt-3 text-xs text-gray-400">
              Credit &amp; background screening runs on the applicant&apos;s secure link (coming next).
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-gray-600">
              Requested
              {application.requested_at
                ? ` ${new Date(application.requested_at).toLocaleString("en-US", { timeZone })}`
                : ""}
              {" · "}
              {application.pay_mode === "landlord" ? "landlord-paid" : "applicant-paid"}. Waiting for the
              applicant to complete it.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-gray-400">
                Applicant link
              </span>
              <input
                type="text"
                readOnly
                value={`${applyBaseUrl}/apply/${application.public_token}`}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              />
            </label>
          </div>
        )
      ) : canApplications ? (
        <form action={requestRentalApplication} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={leadId} />
          <p className="text-sm text-gray-600">
            Send this renter a secure link to complete a rental application. No SIN, birthdate, or banking
            details are collected on this step.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-gray-400">
                Who pays for screening
              </span>
              <select
                name="pay_mode"
                defaultValue="applicant"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="applicant">Applicant pays</option>
                <option value="landlord">I&apos;ll pay</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              style={{ background: "var(--brand-gradient, var(--brand-color))" }}
            >
              Request application
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-3 text-sm text-gray-500">
          Rental applications with built-in credit &amp; background screening are part of{" "}
          <span className="font-medium text-gray-700">Growth</span>.{" "}
          <Link href="/dashboard/billing" className="font-medium text-brand hover:underline">
            Upgrade to request one
          </Link>
          .
        </p>
      )}
    </div>
  );
}
