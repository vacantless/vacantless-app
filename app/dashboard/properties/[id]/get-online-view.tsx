"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const MODE_KEY = "vacantless.getonline.mode";

type Mode = "simple" | "advanced";

export function GetOnlineView({
  simple,
  advanced,
  orgDefaultMode,
  linkIsLive = false,
}: {
  simple: ReactNode;
  advanced: ReactNode;
  orgDefaultMode?: Mode | null;
  linkIsLive?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(
    orgDefaultMode === "advanced" ? "advanced" : "simple",
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_KEY);
    if (saved === "advanced") setMode("advanced");
    else if (saved === "simple") setMode("simple");
  }, []);

  function setAndStore(next: Mode) {
    setMode(next);
    window.localStorage.setItem(MODE_KEY, next);
  }

  if (mode === "advanced") {
    return (
      <div>
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setAndStore("simple")}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            &larr; Simple view
          </button>
        </div>
        {advanced}
      </div>
    );
  }

  return (
    <div>
      {simple}
      <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setAndStore("advanced")}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            {linkIsLive ? "Advanced performance tools" : "Advanced tools"} &rarr;
          </button>
      </div>
    </div>
  );
}
