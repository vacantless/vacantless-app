# CODEX PROMPT — S582: i18n foundation (next-intl, cookie locale) for the command center

Implement this end to end in `vacantless-app`, following every standing constraint
below. **Do not `git push`** — land natively; Noam pushes.

## Why

The accessible command center (design of record:
`claude/DESIGN-PRESENTATION-LAYER-COMMAND-CENTER-S577.md`; build plan:
`claude/BUILD-PLAN-PRESENTATION-LAYER-UI-S578.md`) needs real i18n from day one —
the pinned language dropdown is a core feature, not decoration. Noam picked
**next-intl**. The EN + FR catalog is already extracted and committed at
`messages/en.json` + `messages/fr.json` (single source of truth; every
operator-facing string is a key). This slice stands up the plumbing so future
command-center components can read those catalogs and switch language.

The design uses a language DROPDOWN, not locale-prefixed URLs — so use a
**cookie-based locale**, not `[locale]` route segments.

## Scope

1. Add the `next-intl` dependency.

2. Cookie-based locale helper (e.g. `lib/i18n/locale.ts`):
   - Supported locales `['en','fr']`, default `'en'`.
   - `getUserLocale()` reads the `NEXT_LOCALE` cookie (fallback `'en'`).
   - `setUserLocale(locale)` validates against the supported set and writes the
     cookie.

3. next-intl request config (`i18n/request.ts` via `getRequestConfig`):
   - Resolve the active locale from `getUserLocale()`.
   - Load messages from `messages/{locale}.json` (the existing catalogs — do NOT
     duplicate strings anywhere).
   - Wire `next.config` with the next-intl plugin per the App Router docs.

4. Provider wiring:
   - Add `NextIntlClientProvider` in the root layout passing the active locale +
     messages so client components can use `useTranslations`; server components use
     `getTranslations`.
   - CRITICAL: default locale is `en` and NO existing component consumes
     translations yet, so this MUST NOT change any currently-rendered copy. Verify
     an existing page (e.g. the dashboard) renders identically before/after.

5. A `setLocale` server action (for the pinned dropdown) that calls
   `setUserLocale` + `revalidatePath('/')` (or the relevant path).

6. Do NOT re-author S579's `channelTileLine` / `channelTileStatus.headline` into
   keys in this slice — that is a separate follow-up. S582 is only the plumbing +
   catalogs + switcher.

## Standing constraints

- Land natively; **do not `git push`**.
- Additive; English default; **no visible change to any existing page** (verify a
  real page renders unchanged — this is the main risk, since the root layout is
  shared).
- `messages/en.json` + `messages/fr.json` are the SINGLE source of strings — wire
  to them, never duplicate or hardcode copy.
- tsc clean; if a tsx test fits (locale resolution / cookie validation), add one in
  the existing style. Confirm the app still builds.

## Definition of done

- next-intl installed + configured (cookie locale, request config, provider),
  `useTranslations`/`getTranslations` available app-wide, `setLocale` server action
  present, catalogs wired.
- An existing page renders identically (English), tsc clean, app builds. No visible
  change, no git push.
- Report back the file list + confirm the no-regression check (which page you
  verified renders unchanged).
