# S553 Done-For-You Automation Assembly Line

Dateline: 2026-07-22 EDT

## Source Review

Current done-for-you behavior is `requestConciergePublish(...)` in
`app/dashboard/properties/actions.ts`. It validates the operator, paid listing
marketing entitlement, concierge cap, and current run-item eligibility, then
updates the selected `distribution_run_items` row to:

- `mode = 'concierge'`
- `publish_status = 'queued'`
- `status = 'in_progress'`
- `concierge_requested_at/by`

The superadmin desk in `app/dashboard/admin/concierge` then claims, completes,
or rejects that same row. Completion still requires a real external URL/proof,
writes `listing_posts` for portal channels, appends
`distribution_verifications`, appends `distribution_publish_attempts`, and only
then marks the item Live. That proof-before-Live path is the non-negotiable
contract S553 must preserve.

Existing primitives to reuse:

- `distribution_run_items`: canonical per-channel status visible to the
  operator.
- `distribution_publish_attempts`: append-only history after an attempt.
- `distribution_verifications`: durable proof records.
- `distribution_channel_accounts`: org/channel account truth, setup blockers,
  login/payment status, and partner route state.
- `lib/distribution-capabilities.ts`: static channel capability and account
  readiness matrix.
- `sendOrgNotification(...)`: the single org-facing notification choke point.
- `sendNotificationEmail(...)` plus `adminEmails()`: existing internal staff
  alert substrate.

## S553 Architecture

Add `distribution_jobs` as the durable work-order layer between a concierge
request and attempts/proof. A run item remains the operator-visible truth; a job
is the internal assembly-line truth. One active job is linked to one
`distribution_run_items` row.

Job states:

- `queued`: created from the done-for-you request and ready for a worker/staff.
- `preparing`: the worker claimed the job and is preparing copy/checks.
- `ready_for_human`: enough preparation exists, but a login/payment/CAPTCHA or
  final external submit still requires a person.
- `blocked`: a required account, credential, payment, CAPTCHA, broker handoff,
  or proof gate is missing.
- `completed`: proof has been saved through the existing concierge completion
  path.
- `failed`: the worker/staff hit a terminal error that needs intervention.
- `cancelled`: the request is no longer active.

Channel adapters should classify every channel by capability, not by wishful
automation:

- Vacantless public page / org feed: app-owned automatic surfaces.
- Feed/API partners: can be prepared/submitted only where an accepted route
  exists; still not externally Live without proof.
- Browser/social/portal channels: may get AI-assisted prep, but login, payment,
  CAPTCHA, and final external submit remain human gates.
- Realtor.ca: broker/agent handoff only.
- Custom: manual tracking only.

Claude/Anthropic can prepare only minimum listing/channel instructions after an
explicit job-level consent timestamp exists. The default job carries
`ai_consent_at = null`, so the worker cannot call a model silently. The payload
must exclude lead/tenant/person data and include only channel, address, rent,
basic specs, public listing URL, and already-approved listing copy.

Notifications:

- On queue: alert the Vacantless staff desk immediately and notify the org via
  a registered operator event.
- On blocked: notify staff and operator with the human gate that is blocking
  progress.
- On completed: notify the operator after proof is saved through the existing
  completion path.

Deployment posture:

- Migration is additive and not applied by Codex.
- Worker route is dark unless `DISTRIBUTION_JOBS_ENABLED=true`.
- Missing `distribution_jobs` table fails soft so pre-migration deploys do not
  break the existing passive concierge queue.
- No external portal login, CAPTCHA bypass, payment, final submit, or Live flip
  is introduced by S553.
