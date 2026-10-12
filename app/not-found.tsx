import Link from "next/link";

// S710 audit: a renter who opened a link to a draft or removed rental saw the
// bare framework "404 This page could not be found." Say what happened in
// plain words instead.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Vacantless</p>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">This page is not available</h1>
        <p className="mt-2 text-sm text-gray-600">
          The rental may be rented already, or it is not posted yet. Check the link
          you were sent, or ask the landlord for a new one.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
