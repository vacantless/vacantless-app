"use client";

import { useState } from "react";

// Accessible 1–5 star picker. Renders real radio inputs (so the rating posts
// with the form and works without JS for keyboard users) and overlays a
// hover/selected fill for the familiar star UX. The chosen value posts as the
// form field `rating`.
export function StarRating({ brand }: { brand: string }) {
  const [value, setValue] = useState(0);
  const [hover, setHover] = useState(0);
  const active = hover || value;

  return (
    <div>
      <div
        className="flex justify-center gap-1"
        role="radiogroup"
        aria-label="Rate your showing from 1 to 5 stars"
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= active;
          return (
            <label
              key={n}
              className="cursor-pointer p-1"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
            >
              <input
                type="radio"
                name="rating"
                value={n}
                className="sr-only"
                checked={value === n}
                onChange={() => setValue(n)}
              />
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ color: filled ? brand : "#d4d4d8" }}
                fill="currentColor"
              >
                <path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9l6.6-.9L12 2z" />
              </svg>
              <span className="sr-only">{n} star{n === 1 ? "" : "s"}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-center text-sm text-gray-500">
        {active === 0
          ? "Tap a star to rate"
          : ["", "Poor", "Fair", "Good", "Great", "Excellent"][active]}
      </p>
    </div>
  );
}
