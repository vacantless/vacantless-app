# Vacantless — M1 Foundation

Multi-tenant SaaS scaffold for the lead-to-lease loop. Next.js (App Router) on
Vercel · Supabase (Postgres + Auth + Row-Level Security).

This milestone is the spine: orgs + auth + per-tenant branding + **tenant
isolation enforced by Postgres RLS**. M2 adds the CRM loop.

## What's here

```
app/                  landing, login, signup, onboarding, dashboard, auth routes
lib/supabase/         browser + server + middleware Supabase clients
middleware.ts         refreshes the session, guards /dashboard + /onboarding
supabase/migrations/  0001_init.sql — schema, RLS policies, helper functions
scripts/verify-rls.mjs  the M1 acceptance test (org A cannot read org B)
```

## Setup (once)

### 1. Run the database migration

Supabase dashboard → **SQL Editor** → New query → paste all of
`supabase/migrations/0001_init.sql` → **Run**. It creates the tables, enables
RLS, defines the policies, and grants the `authenticated` role its privileges.

### 2. Turn off email confirmation (dev convenience)

Supabase → **Authentication → Providers → Email** → turn **"Confirm email"
OFF** for now so signups log in instantly. (Re-enable before production.)

### 3. Wire env vars

Copy `.env.local.example` to `.env.local` and fill from Supabase →
**Project Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL` — Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon public key
- `SUPABASE_SERVICE_ROLE_KEY` — service_role key (only used by the RLS test;
  never shipped to the browser)

### 4. Install + run

```bash
npm install
npm run dev        # http://localhost:3000
```

Sign up → create an organization → land on the branded dashboard → add a
property.

## Verify tenant isolation (the M1 gate)

```bash
node --env-file=.env.local scripts/verify-rls.mjs
```

Creates two orgs under two users and asserts neither can read or write the
other's rows. Must print `✅ PASS`.

## Deploy to Vercel

1. Push this folder to a GitHub repo (`vacantless`).
2. Vercel → **Add New → Project** → import the repo.
3. Add the two `NEXT_PUBLIC_*` env vars (Production + Preview). Do **not** add
   the service_role key to Vercel.
4. Deploy. Add the deployed origin to Supabase → **Authentication → URL
   Configuration → Redirect URLs** (`https://your-app.vercel.app/auth/callback`).

## Security notes

- RLS is on for every table; policies gate rows on `organization_id` via the
  `user_org_ids()` SECURITY DEFINER helper (no policy recursion).
- "Automatically expose new tables" is OFF in Supabase; table grants are
  explicit in the migration.
- Secrets live in env vars, never in the repo.
