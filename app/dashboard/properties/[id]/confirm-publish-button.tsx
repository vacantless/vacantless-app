"use client";

import {
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { publishProperty, readSetLiveSiteNotes } from "../actions";
import { setLiveSitesSentence, type SetLiveSiteNote } from "@/lib/set-live-cost-line";
import { readInstantPublishDestinations } from "../distribution-actions";

export type InstantDestination = { key: string; label: string };

type ConfirmPublishButtonProps = {
  propertyId: string;
  label: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  destinations: InstantDestination[];
  address: string;
  id?: string;
  formClassName?: string;
};

function ButtonContent({
  children,
  label,
}: {
  children?: ReactNode;
  label: string;
}) {
  return (
    <>
      {children}
      <span>{label}</span>
    </>
  );
}

export function ConfirmPublishButton({
  propertyId,
  label,
  className,
  style,
  children,
  destinations,
  address,
  id,
  formClassName,
}: ConfirmPublishButtonProps) {
  const [open, setOpen] = useState(false);
  const [freshDestinations, setFreshDestinations] =
    useState<InstantDestination[]>(destinations);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  // S771: the robot sites Set Live also posts to, each with its cost or free count.
  const [siteNotes, setSiteNotes] = useState<SetLiveSiteNote[]>([]);
  const autoId = useId();
  const titleId = `${id ?? autoId}-publish-confirm-title`;
  const hasFreshDestinations = freshDestinations.length > 0 || siteNotes.length > 0;
  const sitesSentence = setLiveSitesSentence(siteNotes);
  const showingInstantCommitment = loadingDestinations || hasFreshDestinations;

  async function openConfirm() {
    setFreshDestinations(destinations);
    setSiteNotes([]);
    setDestinationError(null);
    setOpen(true);
    setLoadingDestinations(true);
    try {
      const [instant, notes] = await Promise.all([
        readInstantPublishDestinations(propertyId),
        readSetLiveSiteNotes(propertyId).catch(() => [] as SetLiveSiteNote[]),
      ]);
      setFreshDestinations(instant);
      setSiteNotes(notes);
    } catch {
      setDestinationError(
        "We could not read your account list. Close this and try again.",
      );
    } finally {
      setLoadingDestinations(false);
    }
  }

  return (
    <div id={id} className={formClassName}>
      <button
        type="button"
        className={className}
        style={style}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openConfirm}
      >
        <ButtonContent label={label}>{children}</ButtonContent>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 text-left shadow-2xl"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {address}
            </p>
            <h2
              id={titleId}
              className="mt-2 text-lg font-semibold text-gray-950"
            >
              {showingInstantCommitment
                ? "Approve connected account posts"
                : "Put your rental page online"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              {showingInstantCommitment
                ? "These accounts get a public post as soon as you approve."
                : "Renters can see your page and book a viewing. Posting to rental sites comes next."}
            </p>

            {/* S732 walk-through: a first-time landlord with nothing connected
                saw "Your own connected accounts receiving a post - No site posts
                yet", which reads as a problem. Show the list only when a
                connected site will post now. */}
            {showingInstantCommitment ? (
            <div className="mt-4 rounded-lg border border-gray-200">
              <h3 className="border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Also posting now to your connected sites
              </h3>
              <ul className="divide-y divide-gray-100">
                {loadingDestinations ? (
                  <li className="px-3 py-2.5 text-sm text-gray-600">
                    Refreshing connected accounts...
                  </li>
                ) : hasFreshDestinations ? (
                  <>
                  {freshDestinations.map((destination) => (
                    <li
                      key={destination.key}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <span className="font-medium text-gray-900">
                        {destination.label}
                      </span>
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-green-700">
                        Instant
                      </span>
                    </li>
                  ))}
                  {siteNotes.map((site) => (
                    <li
                      key={site.key}
                      className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <span className="font-medium text-gray-900">{site.label}</span>
                      <span
                        className={`text-right text-xs ${site.paid || site.capReached ? "font-semibold text-amber-800" : "text-gray-600"}`}
                      >
                        {site.note}
                      </span>
                    </li>
                  ))}
                  </>
                ) : (
                  <li className="px-3 py-2.5 text-sm text-gray-600">
                    No site posts yet.
                  </li>
                )}
              </ul>
            </div>
            ) : null}
            {!loadingDestinations && sitesSentence && (
              <p className="mt-3 text-sm leading-relaxed text-gray-700">{sitesSentence}</p>
            )}
            {destinationError && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {destinationError}
              </p>
            )}

            <form action={publishProperty} className="mt-5 flex flex-wrap gap-2">
              <input type="hidden" name="id" value={propertyId} />
              <button
                type="submit"
                disabled={loadingDestinations || Boolean(destinationError)}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {hasFreshDestinations ? "Approve and post" : "Put it online"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
