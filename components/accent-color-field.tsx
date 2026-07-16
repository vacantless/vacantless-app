"use client";

import { useState } from "react";

// The per-event email accent-color control for Automations & Templates (S332).
// Mirrors the form's "blank = use the default" convention (like the subject /
// message fields): when "Use the default" is checked, the hidden input submits
// "" and the server stores NULL, so the email follows the event default (e.g.
// leasing.new_lead alert red) or the org brand. When unchecked, the operator
// picks a color and we submit the #RRGGBB hex. No raw HTML ever — just a color.
export function AccentColorField({
  name,
  saved,
  fallback,
}: {
  name: string;
  /** The saved hex (e.g. "#dc2626") or "" when the org follows the default. */
  saved: string;
  /** The effective default hex to preview/seed the picker when on default. */
  fallback: string;
}) {
  const [useDefault, setUseDefault] = useState(saved === "");
  const [color, setColor] = useState(saved || fallback || "#dc2626");

  const submitted = useDefault ? "" : color;
  const preview = useDefault ? fallback : color;

  return (
    <div>
      <span className="block text-sm font-medium text-gray-700">Accent color</span>
      <input type="hidden" name={name} value={submitted} />
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-6 w-6 shrink-0 rounded border border-gray-300"
          style={{ backgroundColor: preview }}
        />
        <input
          type="color"
          aria-label="Accent color"
          value={color}
          disabled={useDefault}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-12 cursor-pointer rounded border border-gray-300 bg-white p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
          {useDefault ? "default" : color}
        </code>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={useDefault}
            onChange={(e) => setUseDefault(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
          />
          Use the default
        </label>
      </div>
      <p className="mt-1.5 text-xs text-gray-500">
        Tints the colored bar at the top of this email. Leave on the default to
        follow your brand color.
      </p>
    </div>
  );
}
