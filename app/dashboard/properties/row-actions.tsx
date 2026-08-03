"use client";

import { useState } from "react";
import {
  archiveProperty,
  deleteProperty,
  unarchiveProperty,
} from "./actions";

const BASE_BUTTON =
  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition";

export function DeleteOrArchiveControl({
  propertyId,
  hardDelete,
  archived,
}: {
  propertyId: string;
  hardDelete: boolean;
  archived?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (archived) {
    return (
      <form action={unarchiveProperty}>
        <input type="hidden" name="id" value={propertyId} />
        <button
          type="submit"
          className={`${BASE_BUTTON} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
        >
          Restore
        </button>
      </form>
    );
  }

  const label = hardDelete ? "Delete" : "Archive";
  const action = hardDelete ? deleteProperty : archiveProperty;
  const idleClass = hardDelete
    ? "border-red-300 bg-white text-red-700 hover:bg-red-50"
    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
  const confirmClass = hardDelete
    ? "border-red-600 bg-red-600 text-white hover:bg-red-700"
    : "border-gray-800 bg-gray-800 text-white hover:bg-gray-900";

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <form action={action}>
          <input type="hidden" name="id" value={propertyId} />
          <button type="submit" className={`${BASE_BUTTON} ${confirmClass}`}>
            Confirm?
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={`${BASE_BUTTON} ${idleClass}`}
    >
      {label}
    </button>
  );
}
