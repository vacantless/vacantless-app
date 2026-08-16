"use client";

import {
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { publishProperty } from "../actions";

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
  const autoId = useId();
  const titleId = `${id ?? autoId}-publish-confirm-title`;

  if (destinations.length === 0) {
    return (
      <form action={publishProperty} id={id} className={formClassName}>
        <input type="hidden" name="id" value={propertyId} />
        <button type="submit" className={className} style={style}>
          <ButtonContent label={label}>{children}</ButtonContent>
        </button>
      </form>
    );
  }

  return (
    <div id={id} className={formClassName}>
      <button
        type="button"
        className={className}
        style={style}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
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
              Approve connected account posts
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              These operator-owned connected accounts will receive a public post
              as soon as you approve publishing.
            </p>

            <div className="mt-4 rounded-lg border border-gray-200">
              <h3 className="border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Your own connected accounts receiving a post
              </h3>
              <ul className="divide-y divide-gray-100">
                {destinations.map((destination) => (
                  <li
                    key={destination.key}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <span className="font-medium text-gray-900">
                      {destination.label}
                    </span>
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-green-700">
                      INSTANT
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <form action={publishProperty} className="mt-5 flex flex-wrap gap-2">
              <input type="hidden" name="id" value={propertyId} />
              <button
                type="submit"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Approve &amp; publish
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
