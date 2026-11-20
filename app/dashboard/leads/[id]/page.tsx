import { blockReasonWords, blockedFromEvents, normEmail, type DeliveryRow } from "@/lib/renter-email-block";
import { bookViewingForRenter } from "./book-actions";
import { offerTimesToRenter, withdrawOfferedTimes } from "./offer-times-actions";
import { OFFER_TIMES_MESSAGES, futureOfferSlots, offerReplyText, offerTimesTone } from "@/lib/viewing-offers";
import { CopyTextButton } from "@/components/copy-text-button";
import { formatSlotLong } from "@/lib/booking";
import Link from "next/link";
import { listingUrl, scrubEmDashes } from "@/lib/email";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDemoSession } from "@/lib/demo-account-server";
import { maskEmail, maskPhone, scrubContactText } from "@/lib/demo-account";
import { getCurrentOrg } from "@/lib/org";
import { statusLabel, type LeadStatus } from "@/lib/pipeline";
import { incomeRequirementMagnitude } from "@/lib/screening";
import { isOntarioRental } from "@/lib/credit-check";
import {
  collectPreferenceMismatches,
  preferredAnswerLabel,
  type CustomAnswerSnapshot,
} from "@/lib/screening-questions";
import {
  resolveLeadSource,
  noSuitableTimeBadge,
  followUpStatus,
  followUpLabel,
  rentalClosesFollowUps,
  suggestedNextStageOptions,
  canOfferEarlyTenancy,
  buildReplyDraft,
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
  resendWelcomeReply,
} from "../actions";
import { suggestEmailFix } from "@/lib/email-typo";
import { canUseRentalApplications } from "@/lib/billing";
import { ApplicationCard, type CardApplication, type CardOffer } from "./application-card";
import { OutcomeSelect } from "../../showings/outcome-select";
import { InquiryReplyPanel } from "../inquiry-reply-panel";
import { TextBackPanel } from "../text-back-panel";
import { CHAT_LEAD_LINE, isChatPlaceholder } from "@/lib/chat-leads";
import { orgTextsRenters } from "@/lib/sms";
import { displayCanadianNumber } from "@/lib/texting-setup-emails";
import { buildAiReplyDraft } from "@/lib/ai-reply";
import { loadPropertyKnowledge } from "@/lib/property-qa";
import { PropertyQaPanel } from "../property-qa-panel";
import {
  isFeatureEnabledForOrg,
  loadOrganizationFeatureFlags,
} from "@/lib/feature-entitlements";

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
  no_suitable_time: boolean | null;
  status: LeadStatus;
  notes: string | null;
  move_in: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  created_at: string;
  email_opt_out_at?: string | null;
  sms_opt_out?: boolean | null;
  screen_income_cents: number | null;
  screen_occupants: number | null;
  screen_has_pets: boolean | null;
  screen_pets_detail: string | null;
  qualified_out: boolean;
  qualify_out_reasons: string[] | null;
  screen_custom_answers: CustomAnswerSnapshot[] | null;
  property: {
    id: string;
    address: string;
    postal_code?: string | null;
    status?: string | null;
    rent_cents: number | null;
    beds: number | null;
    baths: number | null;
    parking: string | null;
    available_date: string | null;
    laundry: string | null;
    pet_friendly: boolean | null;
    pets_cats?: boolean | null;
    pets_dogs?: boolean | null;
  } | null;
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

// S750: results of "Book a viewing for this renter".
const BOOK_MESSAGES: Record<string, string> = {
  booked: "Viewing booked. It goes to an agent the same way a renter booking does.",
  no_time: "Pick a date and time.",
  past: "That time has passed. Pick a time later today or after.",
  taken: "Another viewing is already at that time. Pick another time.",
  no_rental: "This renter is not linked to a rental yet.",
  forbidden: "You don't have permission to book viewings.",
  error: "Something went wrong. Please try again.",
};

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { apply?: string; qa?: string; text?: string; book?: string; times?: string; offer?: string; offer_err?: string; resent?: string };
}) {
  const supabase = createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select(
      "id, name, email, phone, source, source_detail, no_suitable_time, status, notes, move_in, next_action_at, next_action_note, created_at, screen_income_cents, screen_occupants, screen_has_pets, screen_pets_detail, qualified_out, qualify_out_reasons, screen_custom_answers, email_opt_out_at, sms_opt_out, property:properties(id, address, postal_code, status, rent_cents, beds, baths, parking, available_date, laundry, pet_friendly, pets_cats, pets_dogs), listing_post:listing_posts(portal, label, url)",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!lead) notFound();
  // S800: the shared demo login sees masked contact details (lib/demo-account.ts).
  const demo = await isDemoSession();
  const rawLead = lead as unknown as Lead;
  const l: Lead = demo
    ? {
        ...rawLead,
        email: maskEmail(rawLead.email),
        phone: maskPhone(rawLead.phone),
        notes: scrubContactText(rawLead.notes),
      }
    : rawLead;

  // S726: is this renter's email on Brevo's blocklist (unsubscribed, spam, bounce)?
  let emailBlock: { since: string; reason: string | null } | null = null;
  const blockKey = normEmail(l.email);
  if (blockKey) {
    const { data: delivery } = await supabase
      .from("email_delivery_events")
      .select("email, event, kind, reason, occurred_at")
      .eq("email", blockKey)
      .in("event", ["blocked", "spam", "delivered", "other"]);
    emailBlock = blockedFromEvents((delivery ?? []) as DeliveryRow[]).get(blockKey) ?? null;
  }

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, channel, direction, body, created_at")
    .eq("lead_id", l.id)
    .order("created_at", { ascending: false });
  const messages = ((msgs ?? []) as Message[]).map((m) =>
    demo ? { ...m, body: scrubContactText(m.body) } : m,
  );

  // S820a: the first reply bounced, or the address looks like a slip
  // ("gmail.comc"). Offer to fix it and send the welcome reply again.
  const { data: bounceRows } = await supabase
    .from("email_delivery_events")
    .select("email, reason, occurred_at")
    .eq("lead_id", l.id)
    .eq("event", "bounced")
    .order("occurred_at", { ascending: false })
    .limit(1);
  const bounce = ((bounceRows ?? []) as { email: string; reason: string | null; occurred_at: string }[])[0] ?? null;
  const currentEmail = (rawLead.email ?? "").trim().toLowerCase();
  const resentAfterBounce =
    !!bounce &&
    messages.some(
      (m) =>
        m.channel === "email" &&
        m.direction === "outbound" &&
        new Date(m.created_at) > new Date(bounce.occurred_at) &&
        (!currentEmail || (m.body ?? "").toLowerCase().includes(currentEmail)),
    );
  const typoFix = demo ? null : suggestEmailFix(rawLead.email);
  const showResend = !demo && !emailBlock && ((!!bounce && !resentAfterBounce) || !!typoFix);

  const { data: showingData } = await supabase
    .from("showings")
    .select("id, scheduled_at, outcome")
    .eq("lead_id", l.id)
    .order("scheduled_at", { ascending: false });
  const showings = (showingData ?? []) as Showing[];

  // S816: every application on this renter (co-applicants too) and the latest
  // offer with its signatures, for the Application and offer card.
  const { data: appRows } = await supabase
    .from("rental_applications")
    .select(
      "id, status, public_token, applicant_name, applicant_email, applicant_phone, requested_at, submitted_at, signed_at, signed_name, credit_check_status, person_id",
    )
    .eq("lead_id", l.id)
    .order("requested_at", { ascending: true });
  const applications = (appRows ?? []) as CardApplication[];
  const { data: offerRow } = await supabase
    .from("application_offers")
    .select(
      "id, status, rent_cents, deposit_cents, start_date, term_months, conditions, landlord_signed_name, landlord_signed_at, tenancy_id, signers:application_offer_signers(id, name, status, signed_at, token, created_at)",
    )
    .eq("lead_id", l.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const offer = (offerRow as CardOffer | null) ?? null;

  // Cancelled-booking cue (S447 Codex P3): a lead can sit at "Booked" after its
  // only viewing was cancelled. Since 0228 a trigger moves such leads back to
  // 'contacted' on cancel, so this cue now only catches rows that predate it or
  // were set back to Booked by hand. Active viewing == still 'scheduled' (not cancelled/attended/no_show).
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
  // S728: Text back shows only when the account really texts and the renter
  // left a number and has not texted STOP.
  const textBack = !!l.phone && !l.sms_opt_out && !!org && (await orgTextsRenters(org.id));

  const timeZone = org?.booking_timezone ?? "America/Toronto";
  // S823c: the times this renter has been offered and has not picked yet.
  const { data: timesOfferRow } = await supabase
    .from("viewing_offers")
    .select("token, proposed_slots")
    .eq("lead_id", l.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pendingOffer = timesOfferRow as { token: string; proposed_slots: unknown } | null;
  const offeredSlots = pendingOffer ? futureOfferSlots(pendingOffer.proposed_slots) : [];
  const offeredLabels = offeredSlots.map((s) => formatSlotLong(s, timeZone));
  const offerLink = pendingOffer ? `${APP_URL}/showing/offer/${pendingOffer.token}` : "";
  const orgName = org?.name ?? "Vacantless";
  const canApplications = canUseRentalApplications(org?.plan);
  // S758: every account sees the tenancy links (S710 hid them from leasing-only
  // orgs, which left the forms and the online lease unreachable).
  const aiReplyFeatureFlags = org
    ? await loadOrganizationFeatureFlags(supabase, org.id, ["ai_reply"])
    : [];
  const applyBannerKey = searchParams.apply ?? null;
  // "Today" in the org's timezone as YYYY-MM-DD (en-CA formats that way).
  const today = new Date().toLocaleDateString("en-CA", { timeZone });

  const sourceDisplay = resolveLeadSource({
    source: l.source,
    source_detail: l.source_detail,
    post: l.listing_post,
  });
  const noSuitableTimeText = noSuitableTimeBadge(l.no_suitable_time);
  // S792: once the rental is rented or off the market the follow-up stops asking.
  const followClosed = !!l.next_action_at && rentalClosesFollowUps(l.property?.status);
  const followStatus = followClosed ? "none" : followUpStatus(l.next_action_at, today);
  const followText = followClosed ? "Closed: this rental is no longer on the market." : followUpLabel(l.next_action_at, today);
  const quickStages = suggestedNextStageOptions(l.status);
  // S724: every draft carries the rental page so the renter can book alone.
  const bookingUrl = l.property?.id ? listingUrl(l.property.id) : null;
  const replyDraft = buildReplyDraft(l, orgName, bookingUrl);
  const canUseAiReply =
    org != null &&
    isFeatureEnabledForOrg(
      "ai_reply",
      { ...org, featureFlags: aiReplyFeatureFlags },
      { env: process.env },
    );
  const propertyKnowledge =
    canUseAiReply && org && l.property?.id
      ? await loadPropertyKnowledge(supabase, org.id, l.property.id)
      : [];
  // S767: a renter saved from a chat (name only). The note is ours, not theirs.
  const chatOnly = isChatPlaceholder(l);
  const aiReplyDraft = canUseAiReply && !chatOnly
    ? buildAiReplyDraft({
        renterName: l.name,
        orgName,
        inquiryText: l.notes,
        moveInDate: l.move_in,
        noSuitableTime: l.no_suitable_time,
        listing: l.property
          ? {
              address: l.property.address,
              rentCents: l.property.rent_cents,
              beds: l.property.beds,
              baths: l.property.baths,
              parking: l.property.parking,
              availableDate: l.property.available_date,
              laundry: l.property.laundry,
              petFriendly: l.property.pet_friendly,
              petsCats: l.property.pets_cats ?? null,
              petsDogs: l.property.pets_dogs ?? null,
            }
          : null,
        knowledge: propertyKnowledge,
        bookingUrl,
      })
    : null;

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
        ← Renters
      </Link>

      <PageHeader
        icon={<Icons.users />}
        title={l.name || l.email || "Unnamed renter"}
        titleNoTranslate={Boolean(l.name || l.email)}
        subtitle={
          <>
            Received {new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })}
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
            {noSuitableTimeText ? (
              <>
                {" · "}
                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  {noSuitableTimeText}
                </span>
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
              Based on your screening criteria, review before deciding.
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
                  {", "}
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
              Doesn&apos;t match a preference you set, just a heads-up, not a flag.
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-sky-900">
            {preferenceMismatches.map((a) => (
              <li key={a.question_id}>
                <span className="font-medium">{a.prompt}</span>, answered{" "}
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
            can create the tenancy now, we&apos;ll mark this inquiry Leased.
          </p>
          <Link
            href={`/dashboard/tenancies/new?from=${l.id}`}
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Create tenancy
          </Link>
        </div>
      ) : null}

      {!emailBlock && l.email_opt_out_at && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">This renter unsubscribed from follow-up emails.</p>
          <p className="mt-1">
            Since {new Date(l.email_opt_out_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: timeZone })},{" "}
            they get no follow-ups, new-times notices or price drops. Their own booking confirmations and
            viewing reminders still go out.
          </p>
        </div>
      )}

      {emailBlock && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">Emails to this renter are not delivered.</p>
          <p className="mt-1">
            Since {new Date(emailBlock.since).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: timeZone })},{" "}
            {blockReasonWords(emailBlock.reason)}, so the email service drops every email to{" "}
            {l.email}. Automatic emails to them are paused. Text or call them instead.
          </p>
        </div>
      )}

      {searchParams.resent === "sent" && (
        <p id="resend" className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Sent. The welcome reply went to {l.email}.
        </p>
      )}
      {showResend && (
        <div id="resend" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            {bounce && !resentAfterBounce
              ? `Your reply to ${bounce.email} did not arrive.`
              : `${l.email} looks mistyped.`}
          </p>
          <p className="mt-1">
            {typoFix ? `Did you mean ${typoFix}? ` : "Check the address with the renter. "}
            Fix it here and we send them the welcome reply again.
          </p>
          <form action={resendWelcomeReply} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={l.id} />
            <input
              name="email"
              type="email"
              required
              defaultValue={typoFix ?? rawLead.email ?? ""}
              className="min-w-[16rem] rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
            />
            <button type="submit" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
              Save and send the reply again
            </button>
          </form>
          {searchParams.resent === "failed" ? (
            <p className="mt-2 text-red-700">We could not send it. Try again, or text or call them.</p>
          ) : searchParams.resent === "bad" ? (
            <p className="mt-2 text-red-700">That does not look like an email address.</p>
          ) : null}
        </div>
      )}

      {chatOnly && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-medium">{CHAT_LEAD_LINE}</p>
          <p className="mt-1 text-blue-800">{l.notes}</p>
        </div>
      )}

      {/* S792: reply and text come first; details, viewings and the application follow. */}
      {!chatOnly && (
      <InquiryReplyPanel
        leadId={l.id}
        propertyId={l.property?.id ?? null}
        email={l.email}
        phone={l.phone}
        subject={replyDraft.subject}
        body={replyDraft.body}
        aiDraft={aiReplyDraft}
        suggestedQuestion={aiReplyDraft?.suggestedQuestion ?? null}
        canCapture={canUseAiReply}
      />
      )}

      {textBack && l.phone && (
        <TextBackPanel leadId={l.id} phoneLabel={displayCanadianNumber(l.phone)} flash={searchParams.text ?? null} />
      )}

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
          value={l.move_in ? new Date(l.move_in).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null}
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

      {l.notes && !chatOnly && (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
            Inquiry message
          </h3>
          <p className="whitespace-pre-wrap text-sm text-gray-700">{l.notes}</p>
        </div>
      )}

      {/* S528: always render the Viewings section — hiding it entirely when
          empty left the pipeline's next step invisible from the lead. */}
      <div className="mt-8" id="viewings">
        <SectionHeading>Viewings</SectionHeading>
      </div>
      {searchParams.book && BOOK_MESSAGES[searchParams.book] && (
        <div
          className={`mb-3 rounded-xl border px-4 py-2 text-sm ${
            searchParams.book === "booked"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {BOOK_MESSAGES[searchParams.book]}
        </div>
      )}
      {searchParams.times && OFFER_TIMES_MESSAGES[searchParams.times] && (
        <div
          className={`mb-3 rounded-xl border px-4 py-2 text-sm ${
            offerTimesTone(searchParams.times) === "good"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {OFFER_TIMES_MESSAGES[searchParams.times]}
        </div>
      )}
      {pendingOffer && (
        <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
          <p className="text-sm font-medium text-gray-900">
            {offeredLabels.length > 0 ? "Times you offered this renter" : "The times you offered have passed"}
          </p>
          {offeredLabels.length > 0 ? (
            <>
              <ul className="mt-1 text-sm text-gray-800">
                {offeredLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-600">
                Nothing is booked until the renter taps one. Replying in a chat or another inbox? Copy the message
                and paste it there.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CopyTextButton
                  value={offerReplyText({
                    renterName: l.name,
                    address: l.property?.address ?? null,
                    whenLabels: offeredLabels,
                    url: offerLink,
                  })}
                  label="Copy the message"
                />
                <CopyTextButton value={offerLink} label="Copy the link only" />
                <form action={withdrawOfferedTimes}>
                  <input type="hidden" name="lead_id" value={l.id} />
                  <button type="submit" className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    Withdraw these times
                  </button>
                </form>
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-gray-600">The renter did not pick one. Offer new times below.</p>
          )}
        </div>
      )}
      {l.property?.id && (
        <details className="mb-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-gray-900">Offer times to this renter</summary>
          <form action={offerTimesToRenter} className="mt-3 space-y-3">
            <input type="hidden" name="lead_id" value={l.id} />
            <p className="text-xs text-gray-600">
              Pick up to three times you can show the rental. The renter sees only these times, never your
              calendar, and the one they tap is booked. Your viewing hours do not need to be open.
            </p>
            <input
              type="datetime-local"
              name="slot"
              required
              aria-label="First time"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              name="slot"
              aria-label="Second time, if you have one"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              name="slot"
              aria-label="Third time, if you have one"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {l.email ? (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="email_renter" value="yes" defaultChecked />
                Email the times to the renter
              </label>
            ) : (
              <p className="text-xs text-gray-600">
                No email on file for this renter. After you save, copy the message and send it yourself.
              </p>
            )}
            <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white">
              {pendingOffer ? "Replace the offered times" : "Offer these times"}
            </button>
          </form>
        </details>
      )}
      {l.property?.id && (
        <details className="mb-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-gray-900">Book a viewing for this renter</summary>
          <form action={bookViewingForRenter} className="mt-3 space-y-3">
            <input type="hidden" name="lead_id" value={l.id} />
            <p className="text-xs text-gray-600">
              Any time works here, even inside your notice. Use it when you set the time with the renter yourself.
            </p>
            <input
              type="datetime-local"
              name="scheduled_at"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="tell_renter" value="yes" defaultChecked />
              Send the renter the confirmation email and text
            </label>
            <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white">
              Book this time
            </button>
          </form>
        </details>
      )}
      {showings.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500 shadow-sm">
          No viewings booked yet. Renters book from your listing page. If
          nothing is bookable, check{" "}
          <Link
            href="/dashboard/availability"
            className="font-medium text-brand hover:underline"
          >
            Set viewing times
          </Link>
          .
        </div>
      ) : (
        <>
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

      {canUseAiReply && l.property?.id && (
        <PropertyQaPanel
          leadId={l.id}
          propertyId={l.property.id}
          entries={propertyKnowledge}
          flash={searchParams.qa ?? null}
        />
      )}

      <ApplicationCard
        leadId={l.id}
        lead={{ name: l.name, email: l.email, phone: l.phone, move_in: l.move_in ?? null }}
        rentCents={l.property?.rent_cents ?? null}
        applications={applications}
        offer={offer}
        canApplications={canApplications}
        appUrl={APP_URL}
        timeZone={timeZone}
        applyBanner={applyBannerKey}
        offerBanner={searchParams.offer ?? null}
        offerError={searchParams.offer_err ?? null}
        screeningName={org?.screening_link_name ?? null}
        hasScreeningLink={!!org?.screening_link_url}
        ontario={isOntarioRental(l.property)}
        ownForm={org?.application_link_url ? { url: org.application_link_url, name: org.application_link_name ?? null } : null}
        tenancyId={existingTenancyId}
      />

      <div className="mt-8">
        <SectionHeading>Activity</SectionHeading>
      </div>

      <form
        action={addNote}
        className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <input type="hidden" name="id" value={l.id} />
        <p className="mb-2 text-xs text-gray-500">
          This only saves a private note for you. It is not sent to the renter.
        </p>
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
          {messages.map((m) => {
            const isNote = m.channel === "note";
            const channelLabel = isNote ? "private note" : (m.channel ?? "note");
            const directionLabel = isNote ? null : m.direction;
            return (
              <li
                key={m.id}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
                  <span className="font-medium uppercase tracking-wider">
                    {channelLabel}
                </span>
                {directionLabel ? (
                  <>
                    <span>·</span>
                    <span>{directionLabel}</span>
                  </>
                ) : null}
                  <span>·</span>
                  <span>{new Date(m.created_at).toLocaleString("en-US", { timeZone })}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-gray-700">
                  {scrubEmDashes(m.body ?? "")}
                </p>
              </li>
            );
          })}
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
            <span className="text-sm text-gray-400">{text || "None scheduled"}</span>
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
          <span className="text-gray-400">-</span>
        )}
      </div>
    </div>
  );
}
