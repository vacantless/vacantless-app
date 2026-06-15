import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand">
        Vacantless
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
        Fill vacancies on autopilot.
      </h1>
      <p className="mt-5 max-w-xl text-lg text-gray-600">
        One product for the whole lead-to-lease loop: branded intake, instant
        replies, self-serve booking, and a pipeline your team actually keeps up
        with.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/signup"
          className="rounded-lg bg-brand px-5 py-2.5 font-medium text-white shadow-sm transition hover:opacity-90"
        >
          Start free
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Log in
        </Link>
      </div>
      <p className="mt-10 text-xs text-gray-400">
        Multi-tenant, row-level isolated — branded intake pages and a lead
        pipeline your team actually keeps up with.
      </p>
    </main>
  );
}
