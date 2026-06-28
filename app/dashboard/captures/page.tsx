import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { canUseCaptureEmailIn, canUseCaptureTextIn } from "@/lib/billing";
import { ingestAddressFromToken, DEFAULT_INGEST_DOMAIN } from "@/lib/email-ingest";
import { CopyTextButton } from "@/components/copy-text-button";
import { createDocumentDownloadUrls } from "@/lib/documents-server";
import {
  plateFieldsToQuery,
  appliancePrefillFromQuery,
  scanExpensePrefillFromQuery,
  type AssetDraft,
} from "@/lib/asset-capture";
import { addAppliance, logScanExpense } from "@/app/dashboard/properties/actions";
import {
  provisionIngestAddress,
  rotateIngestAddress,
  addIngestSender,
  removeIngestSender,
  discardCapture,
} from "./actions";

const APPLIANCE_TYPES = ["fridge", "stove", "dishwasher", "washer", "dryer", "microwave", "other"] as const;

export const dynamic = "force-dynamic";

// Capture Phase 3, Slice 2 — the "Captures" surface: provision the email-in
// address + manage the verified-sender allow-list (this page), and review
// inbound captures (the queue, Slice 2b).
//
// TIER-GATED (S368): email-in is Growth+. A Free org sees the feature LOCKED with
// an upsell (never hidden — feedback_feature_visibility_two_axes). The gate is
// also enforced in every action, so the lock isn't just cosmetic.
//
// Ships DARK: not linked in the nav yet; reachable by direct URL for QA. Nothing
// actually flows in until the provider + MX + INBOUND_WEBHOOK_SECRET are set
// (Slice 3 go-live).
export default async function CapturesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | undefined>;
}) {
  const sp = searchParams ?? {};
  const org = await getCurrentOrg();
  if (!org) {
    return (
      <div className="mx-auto max-w-3xl py-6">
        <p className="text-sm text-slate-400">Sign in with your landlord account to set up capture.</p>
      </div>
    );
  }

  const emailAllowed = canUseCaptureEmailIn(org.plan);
  const textAllowed = canUseCaptureTextIn(org.plan);

  if (!emailAllowed) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 py-6">
        <Header />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-900">Email-in capture is a Growth feature</h2>
          <p className="mt-1 text-sm text-amber-800">
            Forward a photo of an appliance plate or a store receipt to your own
            private address and Vacantless files it into the unit for you. Upgrade
            to Growth to turn it on.
          </p>
          <Link
            href="/dashboard/billing"
            className="mt-3 inline-block rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            See plans
          </Link>
        </div>
      </div>
    );
  }

  const supabase = createClient();
  const { data: addr } = await supabase
    .from("org_ingest_addresses")
    .select("token, created_at")
    .eq("organization_id", org.id)
    .eq("channel", "email")
    .eq("active", true)
    .maybeSingle();

  const { data: senderRows } = await supabase
    .from("org_ingest_senders")
    .select("id, address, verified_at, created_at")
    .eq("organization_id", org.id)
    .eq("channel", "email")
    .order("created_at", { ascending: true });
  const senders = senderRows ?? [];

  const domain = process.env.INGEST_EMAIL_DOMAIN || DEFAULT_INGEST_DOMAIN;
  const address = addr?.token ? ingestAddressFromToken(addr.token, domain) : null;

  // --- Review queue: unconfirmed inbound captures -------------------------
  const { data: captureRows } = await supabase
    .from("documents")
    .select("id, title, mime_type, storage_path, source, ingest_draft, created_at")
    .in("source", ["ingest_email", "ingest_sms"])
    .not("pending_until", "is", null)
    .is("appliance_id", null)
    .is("expense_id", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  const captures = captureRows ?? [];

  // One batched signed-URL mint for the previews.
  const signedByPath = new Map<string, string>();
  if (captures.length > 0) {
    const paths = captures.map((c: { storage_path: string }) => c.storage_path).filter(Boolean);
    const signed = await createDocumentDownloadUrls(supabase, paths);
    if (signed.ok) for (const u of signed.urls) if (u.signedUrl) signedByPath.set(u.path, u.signedUrl);
  }

  // Properties for the "save to unit" picker.
  const { data: propRows } = await supabase
    .from("properties")
    .select("id, address")
    .order("address", { ascending: true });
  const properties = (propRows ?? []) as Array<{ id: string; address: string }>;

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <Header />

      {flash(sp) && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{flash(sp)}</p>
      )}

      {/* Address panel */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Your capture address</h2>
        {!address ? (
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-sm text-slate-500">
              Generate a private address. Then forward a plate or receipt photo to
              it from a verified sender below and it&rsquo;ll appear in your review
              queue.
            </p>
            <form action={provisionIngestAddress} className="mt-3">
              <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                Generate address
              </button>
            </form>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-slate-50 px-2 py-1 text-sm text-slate-800">{address}</code>
              <CopyTextButton value={address} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Forward photos here from a verified sender. Keep it private — if it
              ever leaks, rotate it.
            </p>
            <form action={rotateIngestAddress} className="mt-3">
              <button className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                Rotate address
              </button>
            </form>
          </div>
        )}
      </section>

      {/* Allowed senders */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Allowed senders</h2>
        <p className="text-sm text-slate-500">
          Only mail from these addresses creates a capture. Anything else is held
          aside, not acted on. Add the email address you&rsquo;ll forward from.
        </p>

        <form action={addIngestSender} className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            name="address"
            required
            placeholder="you@example.com"
            className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Add sender
          </button>
        </form>

        {senders.length === 0 ? (
          <p className="text-sm text-slate-400">No senders yet. Add yours above.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {senders.map((s: { id: string; address: string }) => (
              <li key={s.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-slate-800">{s.address}</span>
                <form action={removeIngestSender}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="text-xs font-medium text-slate-400 hover:text-red-600">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Review queue */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">
          Captures awaiting review{captures.length > 0 ? ` (${captures.length})` : ""}
        </h2>
        {captures.length === 0 ? (
          <p className="text-sm text-slate-400">
            Nothing waiting. Forwarded photos will appear here for you to file into
            a unit.
          </p>
        ) : (
          <ul className="space-y-3">
            {captures.map((c: {
              id: string;
              title: string;
              storage_path: string;
              ingest_draft: unknown;
            }) => {
              const raw = (c.ingest_draft ?? null) as AssetDraft | null;
              const draft = raw && (raw.kind === "plate" || raw.kind === "receipt") ? raw : null;
              const q = draft ? plateFieldsToQuery(draft) : {};
              const ap = draft ? appliancePrefillFromQuery(q) : null;
              const exp = draft ? scanExpensePrefillFromQuery(q) : null;
              const preview = signedByPath.get(c.storage_path) ?? null;
              return (
                <li key={c.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{c.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {ap
                          ? [ap.appliance_type, ap.make, ap.model].filter(Boolean).join(" · ") ||
                            "Couldn't read details — file it to a unit below."
                          : "Couldn't auto-read this one — file it to a unit below."}
                        {exp ? ` · $${(exp.total_cents / 100).toFixed(2)}` : ""}
                      </p>
                    </div>
                    {preview && (
                      <a
                        href={preview}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        View
                      </a>
                    )}
                  </div>

                  {/* Save as an appliance to a unit (reuses addAppliance + its promote) */}
                  <form action={addAppliance} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="pending_doc_id" value={c.id} />
                    <input type="hidden" name="install_year" value={ap?.install_year ?? ""} />
                    <input type="hidden" name="warranty_months" value={ap?.warranty_months ?? ""} />
                    <input type="hidden" name="consumable_label" value={ap?.consumable_label ?? ""} />
                    <input
                      type="hidden"
                      name="consumable_interval_months"
                      value={ap?.consumable_interval_months ?? ""}
                    />
                    <label className="text-xs text-slate-500">
                      Unit
                      <select
                        name="property_id"
                        required
                        defaultValue=""
                        className="mt-0.5 block rounded-md border border-slate-300 px-2 py-1 text-sm"
                      >
                        <option value="" disabled>
                          Choose a unit…
                        </option>
                        {properties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.address}
                          </option>
                        ))}
                      </select>
                    </label>
                    <select
                      name="appliance_type"
                      defaultValue={ap?.appliance_type ?? "other"}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {APPLIANCE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      name="make"
                      defaultValue={ap?.make ?? ""}
                      placeholder="Make"
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <input
                      name="model"
                      defaultValue={ap?.model ?? ""}
                      placeholder="Model"
                      className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <input
                      name="serial"
                      defaultValue={ap?.serial ?? ""}
                      placeholder="Serial"
                      className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                      Save to unit
                    </button>
                  </form>

                  {/* If a receipt total was read, also offer logging it as an expense */}
                  {exp && (
                    <form action={logScanExpense} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="pending_doc_id" value={c.id} />
                      <input type="hidden" name="merchant" value={exp.merchant ?? ""} />
                      <input type="hidden" name="incurred_on" value={exp.purchase_date ?? ""} />
                      <input type="hidden" name="amount" value={(exp.total_cents / 100).toFixed(2)} />
                      <input type="hidden" name="category" value="maintenance" />
                      <label className="text-xs text-slate-500">
                        Or log as a ${(exp.total_cents / 100).toFixed(2)} expense on unit
                        <select
                          name="property_id"
                          required
                          defaultValue=""
                          className="mt-0.5 ml-2 inline-block rounded-md border border-slate-300 px-2 py-1 text-sm"
                        >
                          <option value="" disabled>
                            Choose a unit…
                          </option>
                          {properties.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.address}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                        Log expense
                      </button>
                    </form>
                  )}

                  <form action={discardCapture} className="mt-2">
                    <input type="hidden" name="doc_id" value={c.id} />
                    <button className="text-xs font-medium text-slate-400 hover:text-red-600">
                      Discard
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Text-in (Premium) teaser */}
      {!textAllowed && (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Text-in capture</h2>
          <p className="mt-1 text-sm text-slate-500">
            Want to text a photo instead of emailing it? Text-in capture is a
            Premium feature.{" "}
            <Link href="/dashboard/billing" className="font-medium text-slate-700 underline">
              See Premium
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="space-y-1">
      <h1 className="text-xl font-semibold text-slate-900">Captures</h1>
      <p className="text-sm text-slate-500">
        Forward an appliance plate or a store receipt photo to your private
        address and Vacantless reads it and files it into the right unit.
      </p>
    </header>
  );
}

function flash(sp: Record<string, string | undefined>): string | null {
  if (sp.provisioned === "1") return "Address generated. Forward photos to it from a verified sender.";
  if (sp.provisioned === "already") return "You already have an active address.";
  if (sp.rotated === "1") return "Address rotated. Use the new one from now on.";
  if (sp.sender === "added") return "Sender added.";
  if (sp.sender === "removed") return "Sender removed.";
  if (sp.sender === "invalid") return "That doesn't look like a valid email address.";
  if (sp.sender === "error") return "Sorry, that didn't work. Please try again.";
  if (sp.review === "discarded") return "Capture discarded.";
  if (sp.review === "gone") return "That capture was already filed or removed.";
  if (sp.review === "error") return "Sorry, that didn't work. Please try again.";
  if (sp.error === "provision" || sp.error === "rotate") return "Sorry, that didn't work. Please try again.";
  if (sp.locked === "1") return "Email-in capture needs the Growth plan.";
  if (sp.forbidden === "1") return "You don't have permission to manage capture settings.";
  return null;
}
