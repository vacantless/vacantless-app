"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { createPlaidLinkToken, exchangePublicToken } from "./actions";

// Client button that drives Plaid Link. Two steps: click -> mint a link token via
// the server action -> open Plaid Link -> on success, hand the public_token back
// to the server to exchange + store + first-sync, then refresh the page. No keys
// or tokens are persisted in the browser beyond the short-lived link token.
//
// OAuth banks (RBC, TD, Amex CA and many US institutions in PRODUCTION) send the
// browser out to the bank's site and back to our registered redirect_uri, which
// unmounts this page. To resume, we stash the link token before opening Link and,
// on the return leg (Plaid marks the URL with ?oauth_state_id=...), re-open Link
// with receivedRedirectUri set to the current URL. In sandbox there is no OAuth
// redirect, so the stash is written+cleared but the return branch never fires -
// the connect flow is byte-identical to before.

const LINK_TOKEN_KEY = "vacantless.plaid.link_token";

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(LINK_TOKEN_KEY);
  } catch {
    return null;
  }
}

function stashToken(token: string): void {
  try {
    window.localStorage.setItem(LINK_TOKEN_KEY, token);
  } catch {
    // Private-mode / storage-disabled: OAuth resume won't work, but the standard
    // (non-OAuth) flow is unaffected since it never leaves the page.
  }
}

function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(LINK_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function PlaidConnectButton({ className }: { className?: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Set ONLY on the OAuth return leg. Must stay undefined on a fresh connect -
  // passing receivedRedirectUri without an oauth_state_id makes Plaid Link error.
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | undefined>(undefined);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setBusy(true);
      setNote("Importing transactions…");
      clearStoredToken();
      const res = await exchangePublicToken(publicToken);
      setBusy(false);
      setToken(null);
      if (!res.ok) {
        setNote(null);
        setError(res.error);
        return;
      }
      setNote(`Imported ${res.synced} transaction${res.synced === 1 ? "" : "s"}.`);
      router.refresh();
    },
    [router],
  );

  const onExit = useCallback(() => {
    // User abandoned Link (or hit a bank error): drop the stashed token and reset.
    clearStoredToken();
    setToken(null);
    setBusy(false);
  }, []);

  const { open, ready } = usePlaidLink({
    token: token ?? "",
    onSuccess,
    onExit,
    receivedRedirectUri,
  });

  // OAuth return: Plaid redirected the browser back here with an oauth_state_id.
  // Re-hydrate the token saved before the redirect and re-open Link with the
  // current URL so it resumes exactly where it left off.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.search.includes("oauth_state_id=")) return;
    const saved = readStoredToken();
    if (!saved) return;
    setReceivedRedirectUri(window.location.href);
    setToken(saved);
    setBusy(true);
  }, []);

  // Open Link as soon as we have a token and the SDK is ready.
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  const start = useCallback(async () => {
    setError(null);
    setNote(null);
    setBusy(true);
    const res = await createPlaidLinkToken();
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Fresh connect (not an OAuth return): clear any stale redirect state, then
    // stash the token so an OAuth hop can resume it.
    setReceivedRedirectUri(undefined);
    stashToken(res.linkToken);
    setToken(res.linkToken);
  }, []);

  return (
    <div>
      <button type="button" onClick={start} disabled={busy} className={className} aria-busy={busy}>
        {busy ? "Connecting…" : "Connect a bank"}
      </button>
      {note && <p className="mt-2 text-sm text-gray-600">{note}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
