// Plaid adapter for the bank-feed seam — the Growth-tier aggregator. Server-only
// (imports the Plaid SDK + reads secrets); never import into a client component.
//
// Implements BankFeedProvider (./index.ts) so the rest of the app only ever sees
// NormalizedTxn and never the Plaid SDK. The sign convention + dedupe live in the
// seam's pure helpers; this file is just the I/O: mint a link token, exchange the
// public token, list accounts, pull transactions and normalize them.
//
// Config via env (set in Vercel, server-only — NO NEXT_PUBLIC_):
//   PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox|production),
//   PLAID_PRODUCTS (csv, default "transactions"),
//   PLAID_COUNTRY_CODES (csv, default "US,CA").
// Degrades gracefully: plaidConfigured() is false when keys are absent, so the
// route can report "not configured" instead of throwing at import time — same
// discipline as lib/supabase/admin.ts and lib/stripe.ts.

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";
import {
  normalizeAmount,
  type BankFeedProvider,
  type ConnectedAccount,
  type ConnectHandoff,
  type NormalizedTxn,
  type ProviderKey,
} from "./index";

const CLIENT_NAME = "Vacantless";

export function plaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function plaidEnv(): "sandbox" | "production" {
  return process.env.PLAID_ENV === "production" ? "production" : "sandbox";
}

function productsFromEnv(): Products[] {
  const raw = (process.env.PLAID_PRODUCTS || "transactions")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.map((p) => p as Products);
}

function countryCodesFromEnv(): CountryCode[] {
  const raw = (process.env.PLAID_COUNTRY_CODES || "US,CA")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return raw.map((c) => c as CountryCode);
}

function plaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error("Plaid is not configured (PLAID_CLIENT_ID / PLAID_SECRET).");
  }
  const config = new Configuration({
    basePath: PlaidEnvironments[plaidEnv()],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
  return new PlaidApi(config);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export class PlaidProvider implements BankFeedProvider {
  readonly key: ProviderKey = "plaid";

  async startConnect(orgId: string): Promise<ConnectHandoff> {
    const client = plaidClient();
    const res = await client.linkTokenCreate({
      user: { client_user_id: orgId },
      client_name: CLIENT_NAME,
      products: productsFromEnv(),
      country_codes: countryCodesFromEnv(),
      language: "en",
    });
    return {
      provider: "plaid",
      token: res.data.link_token,
      expiresAt: res.data.expiration ?? null,
    };
  }

  async completeConnect(
    publicToken: string,
  ): Promise<{ externalId: string; accessToken: string; institutionName: string | null }> {
    const client = plaidClient();
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    // Best-effort institution name; never fail the connect over it.
    let institutionName: string | null = null;
    try {
      const item = await client.itemGet({ access_token: accessToken });
      const institutionId = item.data.item.institution_id;
      if (institutionId) {
        const inst = await client.institutionsGetById({
          institution_id: institutionId,
          country_codes: countryCodesFromEnv(),
        });
        institutionName = inst.data.institution.name ?? null;
      }
    } catch {
      institutionName = null;
    }

    return { externalId: itemId, accessToken, institutionName };
  }

  async listAccounts(accessToken: string): Promise<ConnectedAccount[]> {
    const client = plaidClient();
    const res = await client.accountsGet({ access_token: accessToken });
    return res.data.accounts.map((a) => ({
      externalId: a.account_id,
      name: a.name ?? null,
      mask: a.mask ?? null,
      type: a.type ?? null,
    }));
  }

  async pullTransactions(accessToken: string, sinceIso: string): Promise<NormalizedTxn[]> {
    const client = plaidClient();

    // Account names for display, keyed by account_id.
    const accountsRes = await client.accountsGet({ access_token: accessToken });
    const accountName = new Map<string, string | null>(
      accountsRes.data.accounts.map((a) => [a.account_id, a.name ?? a.official_name ?? null]),
    );

    const out: NormalizedTxn[] = [];
    const count = 500;
    let offset = 0;
    let total = Infinity;

    // transactionsGet is date-windowed (matches our sinceIso contract) and
    // paginated by offset; loop until we've read total_transactions.
    while (offset < total) {
      const res = await client.transactionsGet({
        access_token: accessToken,
        start_date: sinceIso,
        end_date: todayIso(),
        options: { count, offset },
      });
      total = res.data.total_transactions;
      for (const t of res.data.transactions) {
        // Plaid amounts are in the major unit (dollars), positive = money OUT.
        const cents = Math.round((t.amount ?? 0) * 100);
        const { amountCents, direction } = normalizeAmount(cents, 1);
        const rawCategory =
          t.personal_finance_category?.primary ??
          (Array.isArray(t.category) ? t.category.join(" / ") : null);
        out.push({
          externalId: t.transaction_id,
          accountExternalId: t.account_id,
          accountName: accountName.get(t.account_id) ?? null,
          postedOn: t.date, // YYYY-MM-DD
          amountCents,
          direction,
          merchant: t.merchant_name ?? t.name ?? null,
          description: t.name ?? null,
          rawCategory,
          currency: t.iso_currency_code ?? t.unofficial_currency_code ?? "CAD",
        });
      }
      if (res.data.transactions.length === 0) break; // safety against a stuck offset
      offset += res.data.transactions.length;
    }

    return out;
  }
}

// --- Factory ----------------------------------------------------------------
//
// Resolve a provider key to its adapter. Plaid is live; Flinks is the Premium
// aggregator and is NOT built yet (Slice 6) — selecting it raises a clear error
// rather than silently doing nothing, so a misrouted Premium org is obvious.

export function getBankFeedProvider(key: ProviderKey): BankFeedProvider {
  if (key === "plaid") return new PlaidProvider();
  throw new Error(
    "Flinks bank feed is not available yet. (Premium aggregator ships in a later slice.)",
  );
}
