# CODEX PROMPT - S659b: the auto-post copy now contradicts the confirm gate

Repo: `vacantless-app`. Base: `main` at `b64eb36`.
Branch: `codex/s659b-autopost-copy-accuracy`

## Why

S659 (`51034c3`, merged as `b64eb36`, live since 2026-08-16 14:11:51 UTC) put a confirm in front of
**every** publish path. Approving that confirm is now mandatory before anything reaches the
operator's Instagram or Facebook Page.

The channel-authorization copy was written before that gate existed and still promises the
opposite. Five strings, all live on `b64eb36`, tell the operator that publishing happens
**"automatically without another click"**:

| # | File:line | Current string |
|---|---|---|
| 1 | `app/dashboard/properties/[id]/channel-publish-rail.tsx:175` | "Connected; authorize Vacantless to publish this listing automatically without another click." |
| 2 | `app/dashboard/properties/[id]/channel-publish-rail.tsx:177` | "Authorized; Vacantless can publish this listing automatically without another click." |
| 3 | `app/dashboard/properties/[id]/distribute-tab.tsx:1215` | `aria-label` "Authorize Vacantless to publish this listing to {label} automatically without another click" |
| 4 | `app/dashboard/properties/[id]/page.tsx:1889` | "Vacantless can publish this listing to that connected account automatically without another click." |
| 5 | `app/dashboard/properties/[id]/publish-everywhere.tsx:183-184` | "Authorize Vacantless to publish this listing to this account automatically without another click." |

This is not a nitpick. The Meta App Review screencast films the authorize step and then the confirm
modal. On camera, string 2 or 4 appears seconds before a modal that demands an explicit approval.
A reviewer sees the product contradicting itself, and the written justification promising a
confirm now disagrees with the app's own copy. It also under-sells a safeguard that genuinely
exists.

## Scope

**Copy only. Five strings. No logic, no components, no props, no server actions.**

The accurate model to express: authorizing a channel is a standing, revocable, per-channel
permission; publishing still requires the operator to publish that listing and approve the
confirmation that names the destinations.

Suggested replacements (adjust wording for fit, keep the meaning exact):

1. `channel-publish-rail.tsx:175` -> "Connected; authorize Vacantless to post this listing to this account when you publish."
2. `channel-publish-rail.tsx:177` -> "Authorized; this account receives a post when you publish and approve."
3. `distribute-tab.tsx:1215` aria-label -> "Authorize Vacantless to post this listing to {label} when you publish"
4. `page.tsx:1889` -> "This account will receive a post when you publish this listing and approve the destinations."
5. `publish-everywhere.tsx:183-184` -> "Authorize Vacantless to post this listing to this account when you publish. You still approve the destinations before anything goes out."

Keep every surrounding element identical: the amber styling, the button labels
**"Authorize auto-post"** and **"Turn off auto-post"**, the `"Needs authorization"` /
`"Auto-posting authorized."` headings, the form actions, the `searchParams.dist` branches. Only
the sentences above change.

## Do NOT

- Do NOT rename "Authorize auto-post" or "Turn off auto-post". They appear in the S659 findings doc
  and in the App Review material, and renaming them now creates a fourth name for a control that
  already has too many.
- Do NOT touch `confirm-publish-button.tsx`, `lib/auto-distribution.ts`, or any server action.
- Do NOT change `app/privacy/page.tsx` in this branch.
- Do NOT `git add -A` - commit touched files by name; untracked `claude/*.md` must not be swept in.
- Do NOT push.

## Gates

`npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run test` (report counts),
`git diff --check`, and `git diff --stat main...HEAD`. Report each verbatim.

Also report `git grep -n "without another click" -- app lib` on the branch. **It must return
nothing.** That is the acceptance criterion.

## Commit

```
fix(copy): authorization copy said posting needs no further click

S659 put a mandatory destination confirm in front of every publish path, but the
channel-authorization copy still promised posting happened "automatically without
another click" in five places. The strings now describe what actually happens:
authorizing is a standing per-channel permission, and the operator still publishes
the listing and approves the named destinations before anything goes out.
```
