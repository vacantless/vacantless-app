// Public confirmation page the tenant lands on after the hosted bank-debit
// authorization (Checkout setup session). No auth — the tenant isn't a
// Vacantless user. Stripe also emails them the mandate confirmation; this is
// just a friendly "you're done" page. The landlord confirms the authorization
// on their side via "Refresh status" on the tenancy (increment 2).
export const dynamic = "force-dynamic";

export default function RentAuthorizedPage({
  searchParams,
}: {
  searchParams: { canceled?: string };
}) {
  const canceled = searchParams.canceled === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        {canceled ? (
          <>
            <h1 className="text-lg font-semibold text-gray-900">Authorization not completed</h1>
            <p className="mt-2 text-sm text-gray-600">
              You closed the bank authorization before it finished. No worries —
              you can use the same link again to set it up whenever you&apos;re ready.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-gray-900">You&apos;re all set</h1>
            <p className="mt-2 text-sm text-gray-600">
              Your bank account is authorized for rent payments. You&apos;ll get an
              email confirming the authorization, and a notice before each debit.
              You can close this page.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
