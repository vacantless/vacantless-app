import Link from "next/link";
import { PageHeader, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { Icons } from "@/components/icons";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { approveAndSendPendingMessage, dismissPendingMessage } from "./actions";

export const dynamic = "force-dynamic";

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

type PendingRow = {
  id: string;
  event_key: string;
  tenant_name: string | null;
  tenant_email: string | null;
  subject: string;
  body: string;
  created_at: string;
  property: { address: string | null } | null;
};

// Friendly banner copy keyed off the ?msg= the actions redirect with.
const MSG: Record<string, { tone: "ok" | "err"; text: string }> = {
  sent: { tone: "ok", text: "Sent to the tenant." },
  dismissed: { tone: "ok", text: "Draft dismissed." },
  not_found: { tone: "err", text: "That draft no longer exists." },
  cannot_send: { tone: "err", text: "That draft can't be sent — it may have no tenant email, or it was already handled." },
  cannot_dismiss: { tone: "err", text: "That draft was already handled." },
  send_failed: { tone: "err", text: "The email didn't go through. The draft is still here — try again in a moment." },
  empty_subject: { tone: "err", text: "Add a subject before sending." },
  empty_body: { tone: "err", text: "Add a message before sending." },
  subject_too_long: { tone: "err", text: "That subject is too long." },
  body_too_long: { tone: "err", text: "That message is too long." },
  forbidden: { tone: "err", text: "You don't have permission to send tenant messages." },
};

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

export default async function TenantMessagesPage({
  searchParams,
}: {
  searchParams: { msg?: string };
}) {
  const org = await getCurrentOrg();
  const supabase = createClient();

  const { data } = org
    ? await supabase
        .from("pending_tenant_messages")
        .select(
          "id, event_key, tenant_name, tenant_email, subject, body, created_at, property:properties(address)",
        )
        .eq("organization_id", org.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
    : { data: [] };

  const rows = ((data ?? []) as any[]).map((r) => ({ ...r, property: one(r.property) })) as PendingRow[];
  const banner = searchParams.msg ? MSG[searchParams.msg] : undefined;

  return (
    <div>
      <Link
        href="/dashboard/tenants"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        ← Tenants
      </Link>

      <PageHeader
        icon={<Icons.mail />}
        eyebrow="Tenant communications"
        title="Messages awaiting approval"
        subtitle="Courtesy notes we've drafted for your tenants — triggered by your lease calendar. Nothing here has been sent. Review, edit if you like, then approve to send from your account. These are friendly notes, not legal notices."
      />

      {banner && (
        <p
          className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
            banner.tone === "ok"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {banner.text}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-gray-700">No drafts waiting</p>
          <p className="mt-1 text-sm text-gray-500">
            When a tenant courtesy note is triggered (for example, ahead of a lease
            anniversary), it&apos;ll appear here for you to review and send.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const noEmail = !r.tenant_email;
            return (
              <div
                key={r.id}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {r.tenant_name?.trim() || "Tenant"}
                      {r.property?.address ? (
                        <span className="font-normal text-gray-500">
                          {" "}
                          · {r.property.address}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-gray-500">
                      To: {r.tenant_email || "— no email on file —"}
                    </p>
                  </div>
                </div>

                <form action={approveAndSendPendingMessage} className="space-y-3">
                  <input type="hidden" name="id" value={r.id} />
                  <div>
                    <label className={labelCls}>Subject</label>
                    <input name="subject" defaultValue={r.subject} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Message</label>
                    <textarea
                      name="body"
                      defaultValue={r.body}
                      rows={8}
                      className={`${inputCls} font-sans`}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={noEmail}
                      className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: "var(--brand-gradient, var(--brand-color))" }}
                    >
                      Approve &amp; send
                    </button>
                  </div>
                </form>

                <form action={dismissPendingMessage} className="mt-2">
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className={SECONDARY_ACTION_CLASS}>
                    Dismiss
                  </button>
                </form>

                {noEmail && (
                  <p className="mt-2 text-xs text-amber-600">
                    No email on file for this tenant — add one on the tenancy to send.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
