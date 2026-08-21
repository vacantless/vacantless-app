# CODEX PATCH — fix `exactString` no-op in `lib/relist-radar.ts` (S642, Slice 1 follow-up)

**Repo:** `vacantless-app`. **Target branch:** `codex/s642-relist-radar-clock` (commit
`b26dc286`) — add one commit to the SAME branch before it merges. Do NOT branch anew.

## Problem
`resolveRelistRadarSettings` uses this helper:

```ts
function exactString<T extends string>(value: unknown, expected: T): T {
  return value === expected ? expected : expected;   // both branches return the default
}
```

Both branches return `expected`, so the seven string settings are **never read from the DB** —
they always resolve to the default. It's inert today (each union has one value; Slice 1's detector
only consumes `notify_lead_days`, which is fine), but it silently defeats the requirement that these
settings be **configurable**: the moment a later slice widens any union, a saved override is ignored
with no error.

## Fix
Make the string settings genuinely read from the DB, validated against an allowed-value set (so an
unknown/garbage value still falls back to the default). Seed each allowed set with today's single
value; widening later is just adding to the list.

1. **Remove** `exactString`.
2. **Add** an allowed-value registry + a validating helper:
   ```ts
   const RELIST_RADAR_ALLOWED = {
     refresh_now_semantics: ["confirm_run_on_scheduled_day"],
     free_skip_behavior: ["last_chance_then_lapse"],
     paid_lapse_followup: ["nudge"],
     execution_time: ["expiry_day_morning"],
     email_grouping: ["combined_per_property"],
     autopilot_receipt: ["monthly"],
   } as const;

   function oneOf<K extends keyof typeof RELIST_RADAR_ALLOWED>(
     key: K,
     value: unknown,
   ): (typeof RELIST_RADAR_ALLOWED)[K][number] {
     const allowed = RELIST_RADAR_ALLOWED[key] as readonly string[];
     const fallback = RELIST_RADAR_DEFAULT_SETTINGS[key];
     return (typeof value === "string" && allowed.includes(value)
       ? value
       : fallback) as (typeof RELIST_RADAR_ALLOWED)[K][number];
   }
   ```
3. **Use** `oneOf("refresh_now_semantics", raw.refresh_now_semantics)` etc. for all six string
   fields in `resolveRelistRadarSettings`. Leave `notify_lead_days` on the existing
   `positiveInteger` path.
4. Keep the exported `RelistRadarSettings` type + `RELIST_RADAR_DEFAULT_SETTINGS` shape unchanged
   (values still align to the current single-value unions). Keep `RELIST_RADAR_ALLOWED` and the
   defaults as the single source so a future widening touches one place.

## Test (add to `scripts/test-relist-radar.ts`)
- An **unknown** string for each field → resolves to the default (regression: garbage doesn't stick).
- A **valid** string for each field (its current allowed value, read from a DB-shaped object) → is
  returned unchanged. This is the key guard: it proves the resolver actually reads the value rather
  than always returning the default (which the old code did).
- `notify_lead_days`: a valid positive int is honored; 0 / negative / non-number → default 3.

## Acceptance
`npx tsx scripts/test-relist-radar.ts` green (existing + new cases); `npx tsc --noEmit` clean;
`npm run lint` clean. Still dark — no behavior change with the flag off. Push to the same branch so
the review sees Slice 1 whole.
