"use client";

import { useState } from "react";

// F2 fix (Settings usability audit, S225): the "View public renter page" link
// used to open only the NEWEST property. With multiple active listings an
// operator could never preview the others. This picker lets them choose any
// listing (or none, before any property exists) and open its real /r/{id} page.
//
// Pure client component: no data fetching here — the parent server component
// passes the org's properties + the absolute base URL so the opened tab points
// at the live renter page exactly as a renter would see it.

export type RenterPageProperty = {
  id: string;
  address: string;
  // properties.status — the picker only ever receives publicly-previewable
  // listings (draft/off_market are excluded upstream), so this is one of
  // available / paused / leased.
  status: string;
};

// A leased/paused listing's /r page LOADS but tells renters it's no longer
// available. Surface that in the picker so a previewable-but-not-Live rental
// isn't mistaken for a Live one (Codex QA re-review). null = Live, no note.
function previewStatusNote(status: string): string | null {
  if (status === "leased") return "Leased / no longer available";
  if (status === "paused") return "Paused / not currently available";
  return null;
}

export function RenterPagePreview({
  properties,
  baseUrl,
}: {
  properties: RenterPageProperty[];
  // Absolute origin (e.g. https://app.vacantless.com) or "" to use a relative
  // path. Matched to the same /r/{id} pattern the rest of the app builds.
  baseUrl: string;
}) {
  const [selectedId, setSelectedId] = useState(properties[0]?.id ?? "");

  if (properties.length === 0) {
    return (
      <span className="text-xs text-gray-400">
        Add a property to preview your public renter page.
      </span>
    );
  }

  const href = selectedId ? `${baseUrl}/r/${selectedId}` : "#";
  const selected = properties.find((p) => p.id === selectedId);
  // Note for the currently-selected listing — covers the single-listing case,
  // where the <select> is hidden so the option-level suffix wouldn't show.
  const selectedNote = selected ? previewStatusNote(selected.status) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {properties.length > 1 && (
        <select
          aria-label="Choose a listing to preview"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="max-w-[18rem] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700"
        >
          {properties.map((p) => {
            const note = previewStatusNote(p.status);
            return (
              <option key={p.id} value={p.id}>
                {p.address}
                {note ? ` - ${note}` : ""}
              </option>
            );
          })}
        </select>
      )}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        View public renter page ↗
      </a>
      {selectedNote && (
        <span className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
          {selectedNote}
        </span>
      )}
    </div>
  );
}
