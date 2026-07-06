import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createIncidentMediaDownloadUrls } from "@/lib/incident-media-server";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { workOrderCategoryLabel, workOrderPriorityLabel } from "@/lib/work-orders";
import {
  dispatchStatusLabel,
  tradeStatusHeadline,
  formatDispatchQuote,
  formatDispatchDate,
} from "@/lib/work-order-dispatch";
import type { DispatchMessage } from "@/lib/dispatch-messages";
import { JobForm } from "./job-form";
import { JobMessages } from "./job-messages";

export const dynamic = "force-dynamic";

// Public TRADE job surface (Option B incident-dispatch, Slice 5 — the guardrail
// amendment). The dispatch's `trade_access_token` is the trade's only handle: no
// account, the same magic-link pattern as /sign and /report. Brand-themed like
// the other public pages. The trade can accept / decline / quote / propose a date
// — every action goes through a SECURITY DEFINER RPC that re-derives the dispatch
// from the token. No money moves here: a quote is a recorded number, paid
// directly by the owner off-platform.

type Context =
  | {
      expired: true;
      org_name: string;
      brand_color: string | null;
      brand_color_secondary: string | null;
      logo_url: string | null;
    }
  | {
      expired: false;
      token: string;
      dispatch_status: string;
      trade_name: string | null;
      operator_note: string | null;
      decline_reason: string | null;
      quote_cents: number | null;
      quote_note: string | null;
      proposed_date: string | null;
      scheduled_for: string | null;
      job_title: string;
      job_description: string | null;
      job_category: string;
      job_priority: string;
      job_photos: { path: string }[] | null;
      messages: DispatchMessage[] | null;
      property_address: string | null;
      org_name: string;
      brand_color: string | null;
      brand_color_secondary: string | null;
      logo_url: string | null;
    };

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-2 text-sm last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}

export default async function TradeJobPage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_dispatch_context", {
    p_token: params.token,
  });
  if (!data) notFound();
  const c = data as Context;

  const brand = accessibleBrand(c.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(c.brand_color, c.brand_color_secondary);

  const Header = (
    <header className="relative text-white shadow-md" style={{ background: brandBg }}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
      <div className="mx-auto max-w-2xl px-6 py-5">
        {c.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.logo_url} alt={c.org_name} className="h-8" />
        ) : (
          <p className="text-lg font-bold">{c.org_name}</p>
        )}
      </div>
    </header>
  );

  if (c.expired) {
    return (
      <div className="min-h-screen bg-gray-50" style={{ ["--brand-color" as string]: brand }}>
        {Header}
        <main className="mx-auto max-w-2xl px-6 py-10">
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">This job link has expired.</h1>
            <p className="mt-2 text-sm text-gray-600">
              Please contact {c.org_name} for an up-to-date link.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const isTerminal =
    c.dispatch_status === "completed" ||
    c.dispatch_status === "declined" ||
    c.dispatch_status === "cancelled";

  // The tenant's photos of the problem (if the job came from an incident report).
  // Mint short-lived signed URLs from the PRIVATE incident-media bucket: the trade
  // is account-less, so we sign with the service-role admin client. This is safe
  // because get_dispatch_context already re-derived these paths from the token and
  // returned ONLY this job's photos — we sign exactly what the RPC authorized, and
  // never read paths off the request (feedback_anon_rpc_revalidate_server_side).
  // Best-effort: a signing failure just hides the gallery, never breaks the page.
  const photoUrls: string[] = [];
  if (c.job_photos && c.job_photos.length > 0) {
    const admin = createAdminClient();
    if (admin) {
      const signed = await createIncidentMediaDownloadUrls(
        admin,
        c.job_photos.map((p) => p.path),
      );
      if (signed.ok) {
        for (const u of signed.urls) if (u.signedUrl) photoUrls.push(u.signedUrl);
      }
    }
  }

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{
        ["--brand-color" as string]: brand,
        ["--brand-gradient" as string]: brandBg,
      }}
    >
      {Header}

      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {dispatchStatusLabel(c.dispatch_status)}
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{c.job_title}</h1>
        <p className="mt-1 text-sm text-gray-600">{tradeStatusHeadline(c.dispatch_status)}</p>

        {/* Job detail card */}
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <Detail label="Type" value={workOrderCategoryLabel(c.job_category)} />
          <Detail label="Priority" value={workOrderPriorityLabel(c.job_priority)} />
          {c.property_address ? <Detail label="Location" value={c.property_address} /> : null}
          {c.scheduled_for ? (
            <Detail label="Scheduled" value={formatDispatchDate(c.scheduled_for)} />
          ) : c.proposed_date ? (
            <Detail label="Proposed date" value={formatDispatchDate(c.proposed_date)} />
          ) : null}
          {c.quote_cents != null ? (
            <Detail label="Your quote" value={formatDispatchQuote(c.quote_cents)} />
          ) : null}
          {c.job_description ? (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Details</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{c.job_description}</p>
            </div>
          ) : null}
          {photoUrls.length > 0 ? (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Photos
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photoUrls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt={`Job photo ${i + 1}`}
                      className="h-28 w-full rounded-lg border border-gray-200 object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          {c.operator_note ? (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Note from {c.org_name}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{c.operator_note}</p>
            </div>
          ) : null}
        </div>

        {/* Terminal states: a closing line, no actions. */}
        {isTerminal ? (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-sm">
            {c.dispatch_status === "declined" && c.decline_reason ? (
              <p>You declined this job: &ldquo;{c.decline_reason}&rdquo;</p>
            ) : c.dispatch_status === "completed" ? (
              <p>Thanks — {c.org_name} marked this job complete.</p>
            ) : c.dispatch_status === "cancelled" ? (
              <p>{c.org_name} cancelled this job. No action is needed.</p>
            ) : (
              <p>No further action is needed.</p>
            )}
          </div>
        ) : c.dispatch_status === "scheduled" ? (
          <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800 shadow-sm">
            You&apos;re booked for {formatDispatchDate(c.scheduled_for)}. {c.org_name} will see you then.
          </div>
        ) : (
          <JobForm
            token={c.token}
            status={c.dispatch_status}
            brandBg={brandBg}
            existingQuote={c.quote_cents}
            existingNote={c.quote_note}
            existingProposedDate={c.proposed_date}
          />
        )}

        {/* S329: ask-a-question thread. Visible in every non-expired state — a
            trade can ask BEFORE accepting; the thread stays read-only once the
            job is terminal. */}
        <JobMessages
          token={c.token}
          status={c.dispatch_status}
          orgName={c.org_name}
          brandBg={brandBg}
          messages={c.messages ?? []}
        />
      </main>
    </div>
  );
}
