"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { createPlaidLinkToken, exchangePublicToken } from "./actions";

// Client button that drives Plaid Link. Two steps: click -> mint a link token via
// the server action -> open Plaid Link -> on success, hand the public_token back
// to the server to exchange + store + first-sync, then refresh the page. No keys
// or tokens are persisted in the browser beyond the short-lived link token.

export function PlaidConnectButton({ className }: { className?: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setBusy(true);
      setNote("Importing transactions…");
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

  const { open, ready } = usePlaidLink({ token: token ?? "", onSuccess });

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
