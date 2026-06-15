import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      {/* Hero */}
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand">
          Vacantless
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Fill vacant rentals faster, without chasing every renter.
        </h1>
        <p className="mt-5 text-lg text-gray-600">
          Vacantless gives you one simple place to collect rental inquiries,
          reply quickly, let renters choose showing times, and track who still
          needs follow-up.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-lg bg-brand px-5 py-2.5 font-medium text-white shadow-sm transition hover:opacity-90"
          >
            Start a 30-day pilot
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Log in
          </Link>
        </div>
      </div>

      {/* Product preview — restrained static cards, one per step */}
      <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {PREVIEWS.map((p) => (
          <div
            key={p.title}
            className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">
              {p.step}
            </p>
            <h2 className="mt-2 text-base font-semibold text-gray-900">
              {p.title}
            </h2>
            <p className="mt-1.5 text-sm text-gray-600">{p.body}</p>
            <div className="mt-4">{p.figure}</div>
          </div>
        ))}
      </div>

      <p className="mt-12 text-center text-xs text-gray-400">
        Built for small landlords and rental operators who want fewer missed
        messages, faster replies, and a clearer way to fill vacancies.
      </p>
    </main>
  );
}

const PREVIEWS: {
  step: string;
  title: string;
  body: string;
  figure: React.ReactNode;
}[] = [
  {
    step: "Step 1",
    title: "Your rental inquiry page",
    body: "Share one simple link. Renters ask about the unit, leave their contact details, and tell you when they want to move.",
    figure: (
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="bg-brand px-3 py-2 text-xs font-bold text-white">
          Your Brand
        </div>
        <div className="space-y-1.5 p-3">
          <div className="h-2 w-3/4 rounded bg-gray-200" />
          <div className="h-2 w-1/2 rounded bg-gray-200" />
          <div className="mt-2 h-6 w-28 rounded bg-brand" />
        </div>
      </div>
    ),
  },
  {
    step: "Step 2",
    title: "Your renter list",
    body: "See every interested renter in one place: new, contacted, booked, showed, applied, or leased.",
    figure: (
      <div className="flex gap-1.5">
        {["New", "Replied", "Booked"].map((s, i) => (
          <div
            key={s}
            className="flex-1 rounded-lg border border-gray-200 p-2"
          >
            <div className="text-[10px] font-medium text-gray-500">{s}</div>
            <div className="mt-1.5 space-y-1">
              {Array.from({ length: 3 - i }).map((_, j) => (
                <div key={j} className="h-1.5 rounded bg-gray-200" />
              ))}
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    step: "Step 3",
    title: "Showing times",
    body: "Set your available times. Renters choose a showing without all the back-and-forth messages.",
    figure: (
      <div className="rounded-lg border border-gray-200 p-3">
        <div className="grid grid-cols-3 gap-1.5">
          {["10:00", "10:30", "11:00", "1:30", "2:00", "2:30"].map((t, i) => (
            <div
              key={t}
              className={`rounded px-1 py-1 text-center text-[10px] font-medium ${
                i === 1
                  ? "bg-brand text-white"
                  : "border border-gray-200 text-gray-600"
              }`}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
  },
];
