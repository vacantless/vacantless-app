import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  accessibleBrand,
  brandGradientCss,
  DEFAULT_BRAND_COLOR,
} from "@/lib/brand-theme";
import { recordRenewalIntent } from "./actions";

export const dynamic = "force-dynamic";

// Public tenant RENEWAL CHECK-IN (renewal & rent-increase autopilot Slice A,
// S460). The tenant opens ONE link (their tenancy's renewal_intent_token,
// migration 0131) and answers, in one tap, whether they plan to stay or leave.
// No login: the token is the handle. Read by the service-role admin client,
// scoped strictly to the tenancy whose renewal_intent_token matches; a wrong
// token reveals nothing. The page only RENDERS (GET); each answer POSTs the
// server action, so link scanners that prefetch the GET URL can never answer
// (KI585). Renter PII scope here = the property address only (never the
// tenant's own contact data — the token already identifies them to us).

type Row = {
  id: string;
  status: string | null;
  renewal_intent: string | null;
  property: { address: string | null } | null;
  organization: {
    name: string | null;
    brand_color: string | null;
    brand_color_secondary: string | null;
    logo_url: string | null;
  } | null;
};

const INTENT_LABEL: Record<string, string> = {
  staying: "staying",
  leaving: "planning to move out",
  unsure: "not sure yet",
};

export default async function RenewalCheckinPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  const admin = createAdminClient();
  if (!admin) notFound();

  const { data } = await admin
    .from("tenancies")
    .select(
      "id, status, renewal_intent, " +
        "property:properties(address), " +
        "organization:organizations(name, brand_color, brand_color_secondary, logo_url)",
    )
    .eq("renewal_intent_token", params.token)
    .maybeSingle();
  if (!data) notFound();
  const t = data as unknown as Row;

  const orgName = t.organization?.name || "Your landlord";
  const accent = accessibleBrand(t.organization?.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(
    t.organization?.brand_color,
    t.organization?.brand_color_secondary,
  );
  const address = t.property?.address?.trim() || "your home";
  const logo = t.organization?.logo_url?.trim() || null;

  const status = searchParams.status ?? "";
  const justRecorded = status.startsWith("recorded_")
    ? status.slice("recorded_".length)
    : null;
  const errored = status === "error" || status === "invalid";

  // The answer to reflect back: a fresh submit wins; otherwise whatever is on
  // file. Once we have an answer we show the thank-you state (still changeable).
  const answered = justRecorded || t.renewal_intent || null;

  const OPTIONS: { choice: string; title: string; sub: string }[] = [
    { choice: "staying", title: "I'm staying", sub: "I'd like to renew and stay in my home." },
    { choice: "leaving", title: "I'm moving out", sub: "I'm planning to leave when my term ends." },
    { choice: "unsure", title: "I'm not sure yet", sub: "I haven't decided — check back with me." },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="px-5 py-8 text-white" style={{ background: brandBg }}>
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={orgName} className="h-9 w-9 rounded-lg bg-white/90 object-contain p-1" />
          ) : null}
          <p className="text-sm font-medium opacity-90">{orgName}</p>
        </div>
        <div className="mx-auto mt-4 max-w-lg">
          <h1 className="text-2xl font-semibold leading-snug">
            A quick check-in about {address}
          </h1>
          <p className="mt-2 text-sm opacity-90">
            Your lease is coming up for renewal. Let {orgName} know your plans —
            it takes one tap, and there’s nothing else to fill out.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-lg px-5 py-8">
        {errored && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            That link didn’t work. Please use the most recent link {orgName} sent
            you, or reply to their message.
          </div>
        )}

        {answered ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-lg font-semibold text-gray-900">Thank you — got it.</p>
            <p className="mt-2 text-sm text-gray-600">
              We’ve let {orgName} know you’re{" "}
              <span className="font-medium">{INTENT_LABEL[answered] ?? answered}</span>.
              You can change your answer below if your plans change.
            </p>
            <div className="mt-5 grid gap-2">
              {OPTIONS.filter((o) => o.choice !== answered).map((o) => (
                <form action={recordRenewalIntent} key={o.choice}>
                  <input type="hidden" name="token" value={params.token} />
                  <input type="hidden" name="choice" value={o.choice} />
                  <button
                    type="submit"
                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Actually, {o.title.toLowerCase()}
                  </button>
                </form>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {OPTIONS.map((o) => (
              <form action={recordRenewalIntent} key={o.choice}>
                <input type="hidden" name="token" value={params.token} />
                <input type="hidden" name="choice" value={o.choice} />
                <button
                  type="submit"
                  className="w-full rounded-2xl border-2 bg-white p-5 text-left shadow-sm transition hover:shadow-md"
                  style={{ borderColor: accent }}
                >
                  <span className="block text-lg font-semibold text-gray-900">{o.title}</span>
                  <span className="mt-0.5 block text-sm text-gray-600">{o.sub}</span>
                </button>
              </form>
            ))}
            <p className="mt-2 text-center text-xs text-gray-400">
              Your answer goes only to {orgName}.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
