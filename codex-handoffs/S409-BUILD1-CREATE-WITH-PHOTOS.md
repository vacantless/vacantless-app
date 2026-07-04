# S409 BUILD 1 - create a rental WITH its photos in one step (Codex review request)

Date: 2026-07-04
Repo: `vacantless-app` on `main`
Review target: the single S409 BUILD-1 commit (this note is committed in it).
Scope: core `addProperty` server-action change + a shared photo-upload helper +
one form field. Code-only, no migration, no env.

## Why

S408 diagnosed the FB new-link conversion leak as front-of-funnel: the unit had 0
photos on its public `/r` page. The hand-fix was uploading photos separately after
the listing was already created. This build closes that gap at the source so a new
listing can never launch photoless: the "Add a rental" form now takes photos, and
`addProperty` attaches them in the same step (still landing as a private draft to
review, then Publish).

## Files touched

- `app/dashboard/properties/actions.ts`
  - **New `photoFilesFromForm(formData)`** - pulls the `photos` File entries,
    dropping the 0-byte entry an empty input yields. Extracted verbatim from the
    old inline filter in `uploadPropertyPhotos`.
  - **New `uploadPhotosForProperty(supabase, org, propertyId, files, existingRows)`**
    - the validate + plan-cap + store + insert loop, lifted verbatim out of
    `uploadPropertyPhotos`. Routing-free (no redirect/revalidate); returns
    `{ ok: true, uploaded } | { ok: false, reason }`. Best-effort per file with the
    same orphan-object rollback on a failed row insert.
  - **`uploadPropertyPhotos` refactored** onto the two helpers. Behavior identical:
    `none` (no files), `max` (over cap), a per-file validation reason, and `failed`
    (0 uploaded) all still redirect to `?photoerr=<reason>`; success still
    `revalidatePath` + `?photos=<n>`. The `fail` helper is now typed `: never` and
    the guards use `return fail(...)` so the discriminated union narrows.
  - **`addProperty` change** - the insert now `.select("id").single()`s to get the
    new id. After the existing draft insert + revalidate, if the operator picked
    photos it calls `uploadPhotosForProperty(..., newId, files, [])` (a new unit has
    no existing photos), revalidates the new property page, and redirects to the
    review page reusing the existing banners: `?photos=<n>` on success, or
    `?photoerr=<reason>` if photos failed (the **draft is still created either
    way** - photos never block the create). When no photos are picked, it falls
    through to the **unchanged** `?added=<nonce>` list redirect (byte-identical to
    before, including the form-remount nonce).
- `app/dashboard/properties/page.tsx`
  - Added `encType="multipart/form-data"` to the add form and a full-width
    `<input type="file" name="photos" accept="image/*" multiple>` labeled optional
    ("add them now so it's ready to share the moment you publish, or add later").

## Safety / what did NOT change

- No migration, no env, no new dependency, no client component.
- The photo cap, per-file validation (`validatePhotoUpload`), storage path scheme,
  cover-photo rule (first photo becomes cover), and orphan-rollback are the same
  code path for both entry points now (single source of truth).
- `addProperty` still creates the unit as `status: "draft"` (private until
  reviewed) - photos do not change that.
- `organization_id` still comes from `getCurrentOrg()`; RLS WITH CHECK unchanged,
  no cross-tenant write. `uploadPhotosForProperty` writes `organization_id: org.id`
  on every photo row exactly as before.
- The no-photo add path is unchanged (same `?added=` remount-nonce redirect).

## Points worth a close look

- The `fail`/`return fail(...)` narrowing in `uploadPropertyPhotos` and the
  `if (result.ok) redirect(...)` / else `?photoerr` fall-through in `addProperty`.
- `.single()` after the insert: on an insert failure `inserted` is null, `newId`
  is null, and we skip photos and fall through to the list redirect (no 500).
- Best-effort semantics: if SOME files fail but >=1 uploads, `addProperty` treats
  it as success (`?photos=<n>`), matching `uploadPropertyPhotos`.

## Verification (here)

- `npx tsc --noEmit` - clean (exit 0).
- `npx eslint --no-cache` on both changed files - green (exit 0).
- Regression suites: `test-photos` 68/0, `test-rental-lifecycle` 82/0,
  `test-rental-readiness` 44/0, `test-rental-next-action` 51/0.
- Live North Star QA test: [to be run post-deploy - add a rental with 1-2 photos,
  confirm it lands as a draft on the review page with the photo gallery + the
  "N photos added" banner, and the public `/r` page leads with the gallery].
