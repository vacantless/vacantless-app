# SCOPE S679 - Self-serve channel connect, the real gate to selling Kijiji

_2026-09-04. Written after Noam asked how the payment-prompt lane works for other
operators. The answer is that the prompt scales fine and the SESSION does not. NOTHING IS
BUILT HERE. This is a decision document: the trust posture has to be chosen before any
code is worth writing._

## The state today, from the code

**Facebook is the only channel with a self-serve connect route.** `app/api/integrations/`
contains exactly one integration: `facebook/connect` and `facebook/callback`. There is no
generic connect surface for a password portal.

**The crypto half is already built and proven.** `lib/distribution-session-crypto.ts` lets
the APP write `distribution_channel_sessions` with the same AES-256-GCM envelope the
worker reads, and it is in production use today for Facebook Page tokens
(`lib/facebook-page-oauth.ts`). The table is keyed `(organization_id, channel)`. **So
storing a per-operator Kijiji session needs no new schema and no new crypto.**

**What is missing is ACQUISITION.** OAuth hands you a credential for free. Kijiji has no
OAuth, so the only artifact that works is a Playwright `storageState` captured from a
browser that has already logged in.

**And that capture is a terminal command.** `vacantless-worker/src/warm-session.ts`
(`npm run warm`) opens a headed Chromium, waits for a human to log in, captures
`context.storageState()`, encrypts it and upserts it. It requires `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SESSION_ENC_KEY` and `TARGET_ORG_ID` from a `.env`.

**Therefore onboarding operator number two means Noam runs a terminal command on his own
machine while that operator supplies their Kijiji password.** That is the whole finding.

## The extension is NOT the answer, and says so itself

`vacantless-extension/README.md` lists as a hard boundary: *"Never signs in, never enters
payment... Holds no passwords or tokens."* It already has kijiji.ca host permissions and
already runs there, so it is technically the closest thing to a capture point. Using it
that way **inverts its stated security posture**, which is also what it tells users and
what a Chrome Web Store reviewer reads. Do not do this quietly. If it is ever the chosen
path it needs a deliberate, disclosed change, not a patch.

## The four shapes, and what each one really costs

### A. Concierge onboarding. Do not self-serve it at all.
Noam (or a support person) warms each operator's session as a setup step. **This is what
happens today.** Zero build. Honest. It caps the number of operators at how many logins
one person can sit through, and it means Vacantless staff are present when a customer
types their password, which is its own liability.

### B. Productize `warm` as a signed local helper.
Ship a small downloadable that does what `npm run warm` does but authenticates with a
short-lived scoped token instead of the service-role key, and writes through an app
endpoint rather than straight to Postgres. **Smallest product surface, worst onboarding**
(a rental operator is being asked to download and run a binary). Removes the
service-role-key-on-a-laptop problem, which is worth something on its own.

### C. Hosted headed browser the operator drives in-product.
A streamed Playwright session inside Vacantless: operator logs into Kijiji in a window we
render, we capture the storageState at the end. **Best onboarding by a distance.** Also
the biggest build, and it means the customer types their Kijiji password into a browser
Vacantless operates.

### D. Extension-assisted capture.
Cheapest technically, since the extension is already on the page. **Costs the extension's
stated boundary and invites a store-review problem.** See above.

## The trust question, stated plainly so it is not hand-waved

Under B, C and D, Vacantless ends up custodying a live Kijiji session for a customer's
business account. **That is already true today for Agile.** So the incremental change is
smaller than it first looks: what actually changes is **who typed the password** and
**whether the customer was told clearly what is being stored.**

What follows from that, whichever shape is picked:
- Sessions need an expiry and a revoke control the operator can reach. `expires_at` is
  **NULL on every row today** and nothing reads it (S304 found the same thing).
- The operator needs to be able to see "connected, last validated <date>" and disconnect.
  Neither exists.
- `account_status` should become **derived from a real validation**, not typed in a
  dropdown. That is the same defect S679 found on the Agile row, and at N operators a
  hand-typed status field stops being cosmetic and starts being support tickets.

## Recommendation

**Stay on A while there is one operator, and pick between B and C before taking the
second.** Do not build any of it this session. The decision that unlocks the work is not
technical: it is whether Vacantless is willing to be the custodian of customer portal
logins as a stated product feature, with the expiry, revoke and disclosure that implies.

If the answer is yes, C is the one that sells, and B is a sensible first step toward it
because the endpoint and the scoped-token exchange are reusable.

If the answer is no, then Kijiji is a concierge-onboarded channel forever, that is a fine
answer, and it should be written down as a deliberate state rather than rediscovered.

## Not in scope

- The CVV wall. Unrelated and permanent. [[project_kijiji_fee_wall_cvv]]
- The payment prompt. Separate and additive. `SCOPE-S679-KIJIJI-PAYMENT-PROMPT-LANE.md`
- Where the worker runs. Still the Hetzner box.

[[project_agile_leasing_engine]] [[project_kijiji_lane_real_gate]]
