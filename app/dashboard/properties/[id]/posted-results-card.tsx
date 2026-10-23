// S734: the screen right after "Post everywhere". One card: every live ad
// with its link, the one booking link, what happens next, and the free wins
// still on the table. This is the moment a landlord screenshots for a friend.
import Link from "next/link";
import { CopyLink } from "./copy-link";
import {
  postedResultsHeadline,
  type PostedResultsNext,
  type PostedResultsSite,
} from "@/lib/posted-results";

export function PostedResultsCard({
  publicUrl,
  sites,
  nextSteps,
}: {
  publicUrl: string;
  sites: PostedResultsSite[];
  nextSteps: PostedResultsNext[];
}) {
  return (
    <section
      id="posted-results"
      className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Posted</p>
      <h2 className="mt-1 text-xl font-bold text-emerald-950">{postedResultsHeadline(sites.length)}</h2>
      <ul className="mt-3 space-y-1.5 text-sm text-emerald-950">
        <li className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Your Vacantless page</span>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="font-semibold text-emerald-800 underline">
            Open ↗
          </a>
        </li>
        {sites.map((site) => (
          <li key={site.key} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{site.label}</span>
            <a href={site.url} target="_blank" rel="noreferrer" className="font-semibold text-emerald-800 underline">
              See the ad ↗
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <p className="mb-1 text-xs font-semibold text-emerald-900">Your booking link. Every ad points here.</p>
        <CopyLink url={publicUrl} />
      </div>

      <p className="mt-4 text-sm text-emerald-950">
        <span className="font-semibold">What happens next.</span> A renter writes on any of these sites.
        They show up in Renters, and our reply carries your booking link. We email you each new inquiry.
        Renters pick a viewing time themselves.
      </p>

      {nextSteps.length > 0 && (
        <div className="mt-4 border-t border-emerald-200 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Add more sites</p>
          <ul className="mt-2 space-y-3">
            {nextSteps.map((step) => (
              <li key={step.key} className="rounded-xl border border-emerald-200 bg-white p-3">
                <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                <p className="mt-0.5 text-xs text-gray-600">{step.body}</p>
                <Link
                  href={step.href}
                  className="mt-2 inline-flex rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  {step.action}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
