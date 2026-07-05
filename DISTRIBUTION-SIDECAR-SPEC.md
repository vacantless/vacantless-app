# Distribution browser sidecar — spec (PARKED)

Date: 2026-07-04
Status: **PARKED** — not built in the S412 batch. Separate effort (Chrome
extension repo + Web Store review). This documents the honest, policy-safe design
so it's ready when we choose to build it.

## What it is
A small Chrome side panel that sits beside Kijiji / Facebook Marketplace /
Rentals.ca / Zumper while the operator posts, showing the next field to paste from
a Vacantless launch run. It makes assisted-manual posting feel guided without any
automation.

## Hard boundaries (non-negotiable)
Chrome Web Store program policies require honest, clearly-disclosed, user-driven
functionality (https://developer.chrome.com/docs/webstore/program-policies/). So:
- **No auto-submit.** The extension never clicks Post/Publish or submits a form.
- **No scraping.** It does not read the portal's private data or the user's
  account; it only shows Vacantless's own launch-run content.
- **No credential handling.** It never touches the user's portal login.
- **No CAPTCHA / anti-bot bypass.**
- **User-driven only.** Every action is a "Copy next field" / "Mark done" the
  operator clicks. The extension writes to the clipboard on user gesture, nothing
  more.
- **Transparent + disclosed.** The listing/store description states exactly what it
  does and does not do.

Meta/Facebook automation is especially high-risk — Facebook stays "assisted
manual", never "syndication". Do NOT build credentialed posting.

## Architecture sketch
- A Vacantless-authed read-only endpoint returns the active launch run for a
  property: ordered steps + the field values (title, body, fields, tracked URL,
  QR). Reuses `lib/distribution-run` + the fill sheet — same content the in-app
  panel shows.
- The extension side panel renders the steps and offers "Copy next field" +
  "Mark step done" (the latter calls the same `updateRunItem` action). No DOM
  writes into the portal page.

## Trigger to build
When manual posting volume justifies it (a paid pilot doing several listings/week
across channels) AND we can commit to the Web Store review. Until then, the in-app
launch run (Slice 2) already delivers the guided-checklist value.
