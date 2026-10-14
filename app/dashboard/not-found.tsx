import Link from "next/link";
import { getCurrentOrg } from "@/lib/org";

// S715: a link from an alert email, opened while signed in to a different
// account, showed the renter page ("the rental may be rented already, ask the
// landlord"). Inside the dashboard, say which account is open and how to switch.
export default async function DashboardNotFound() {
  const org = await getCurrentOrg().catch(() => null);
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">We could not find that page in this account</h1>
        <p className="mt-2 text-sm text-gray-600">
          {org?.name ? (
            <>
              You are signed in to <span className="font-medium text-gray-900">{org.name}</span>.{" "}
            </>
          ) : null}
          Was the link for another account? Sign out, then sign in to that one. The rental may
          also have been deleted.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/dashboard"
            className="inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Go to your dashboard
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
