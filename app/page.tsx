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
          Fill vacancies faster, without chasing every lead.
        </h1>
        <p className="mt-5 text-lg text-gray-600">
          One product for the whole lead-to-lease loop: a branded intake page,
          instant replies, self-serve showing booking, and a pipeline your team
          actually keeps up with.
        </p>
        <div className="mt-8 flex justify-center gap-3">
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
      </div>

      {/* Product preview — restrained static cards, one per step of the loop */}
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
        Multi-tenant and row-level isolated — every workspace gets its own
        branded intake pages and a lead pipeline your team actually keeps up
        with.
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
    title: "Branded intake page",
    body: "Share one link. Renters inquire on a page that looks like you, not a generic form.",
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
    title: "Lead pipeline",
    body: "Instant auto-replies, then every inquiry lands in a pipeline your team keeps moving.",
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
    title: "Self-booked showings",
    body: "Renters pick a time from your availability. No back-and-forth, no double-booking.",
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
