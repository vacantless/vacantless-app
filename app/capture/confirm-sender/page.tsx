import { confirmSenderAddress } from "./actions";
import { isValidSenderConfirmToken } from "@/lib/email-ingest";

// Public sender-confirmation landing page (capture ingress F4, S379). No auth —
// the landlord clicks the link emailed to the forwarding address they added. The
// GET render has NO side effect (it shows a Confirm button that POSTs the token),
// so an email-security scanner that prefetches the link cannot auto-confirm it.
// The actual verified_at flip happens in confirmSenderAddress on POST.
export const dynamic = "force-dynamic";

export default function ConfirmSenderPage({
  searchParams,
}: {
  searchParams?: { token?: string; status?: string };
}) {
  const status = searchParams?.status;
  const token = searchParams?.token;

  // Post-submit result states.
  if (status) return <Shell>{result(status)}</Shell>;

  // Initial GET. A malformed/absent token shows the same neutral "invalid" state
  // (no enumeration). A well-formed token gets a Confirm button that POSTs it.
  if (!isValidSenderConfirmToken(token)) return <Shell>{result("invalid")}</Shell>;

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-gray-900">Confirm your forwarding address</h1>
      <p className="mt-2 text-sm text-gray-600">
        Confirm this address so you can forward photos of appliance plates and
        receipts straight into your units.
      </p>
      <form action={confirmSenderAddress} className="mt-5">
        <input type="hidden" name="token" value={token} />
        <button className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Confirm address
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        {children}
      </div>
    </main>
  );
}

function Check() {
  return (
    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function result(status: string) {
  switch (status) {
    case "confirmed":
      return (
        <>
          <Check />
          <h1 className="text-lg font-semibold text-gray-900">Address confirmed</h1>
          <p className="mt-2 text-sm text-gray-600">
            You can now forward appliance and receipt photos from this address and
            they&rsquo;ll appear in your review queue. You can close this page.
          </p>
        </>
      );
    case "already":
      return (
        <>
          <Check />
          <h1 className="text-lg font-semibold text-gray-900">Already confirmed</h1>
          <p className="mt-2 text-sm text-gray-600">
            This address is already confirmed. You can close this page.
          </p>
        </>
      );
    case "expired":
      return (
        <>
          <h1 className="text-lg font-semibold text-gray-900">This link has expired</h1>
          <p className="mt-2 text-sm text-gray-600">
            Confirmation links are valid for a limited time. Open your capture
            settings in Vacantless and use &ldquo;Resend&rdquo; to get a fresh link.
          </p>
        </>
      );
    default: // invalid | error
      return (
        <>
          <h1 className="text-lg font-semibold text-gray-900">This link is no longer valid</h1>
          <p className="mt-2 text-sm text-gray-600">
            It may have already been used or replaced by a newer one. Open your
            capture settings in Vacantless and use &ldquo;Resend&rdquo; if you still
            need to confirm an address.
          </p>
        </>
      );
  }
}
