"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  tradeActionsFor,
  tradeDispatchErrorMessage,
} from "@/lib/work-order-dispatch";
import { acceptDispatch, declineDispatch, submitDispatchQuote } from "./actions";

// Trade-side interaction for /job/[token] (Option B Slice 5). Pure client; every
// action calls a server action whose SECURITY DEFINER RPC re-validates the state
// machine. On success we router.refresh() so the page re-reads the dispatch and
// renders the next state. No money moves — a quote is a recorded number.
export function JobForm({
  token,
  status,
  brandBg,
  existingQuote,
  existingNote,
  existingProposedDate,
}: {
  token: string;
  status: string;
  brandBg: string;
  existingQuote: number | null;
  existingNote: string | null;
  existingProposedDate: string | null;
}) {
  const router = useRouter();
  const actions = tradeActionsFor(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // decline
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  // Slice 0 Block A: agree to the Vacantless Trade Terms before accepting.
  const [termsAccepted, setTermsAccepted] = useState(false);

  // quote
  const [showQuote, setShowQuote] = useState(status === "accepted");
  const [quote, setQuote] = useState(
    existingQuote != null ? (existingQuote / 100).toString() : "",
  );
  const [note, setNote] = useState(existingNote ?? "");
  const [proposedDate, setProposedDate] = useState(existingProposedDate ?? "");

  async function onAccept() {
    if (!termsAccepted) return;
    setBusy(true);
    setError(null);
    const res = await acceptDispatch({ token, termsAccepted });
    setBusy(false);
    if (!res.ok) {
      setError(tradeDispatchErrorMessage(res.reason));
      return;
    }
    router.refresh();
  }

  async function onDecline() {
    setBusy(true);
    setError(null);
    const res = await declineDispatch({ token, reason: declineReason || null });
    setBusy(false);
    if (!res.ok) {
      setError(tradeDispatchErrorMessage(res.reason));
      return;
    }
    router.refresh();
  }

  async function onSubmitQuote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await submitDispatchQuote({
      token,
      quote,
      note: note || null,
      proposedDate: proposedDate || null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(tradeDispatchErrorMessage(res.reason));
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* OFFERED: accept / decline */}
      {actions.includes("accept") && !declining ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-700">
            Can you take this job? Accept to send a quote, or decline.
          </p>

          {/* Slice 0 Block A: short in-line notice + required Terms checkbox. */}
          <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
            By accepting this job you agree to the Vacantless Trade Terms. In short: Vacantless is a
            scheduling and messaging tool used by the property owner or manager who sent you this job.
            Vacantless is not the customer, is not hiring you, does not pay you, and is not a party to
            your agreement with the owner. You arrange payment and the work directly with the owner.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              I have read and agree to the{" "}
              <a
                href="/legal/trade-terms"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
                style={{ color: "var(--brand-color)" }}
              >
                Vacantless Trade Terms
              </a>
              .
            </span>
          </label>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onAccept}
              disabled={busy || !termsAccepted}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: brandBg }}
            >
              {busy ? "Working…" : "Accept job"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(true)}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}

      {/* DECLINE confirm */}
      {declining ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <label className="block text-sm font-medium text-gray-700">
            Reason (optional)
          </label>
          <textarea
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
            placeholder="e.g. Booked solid this month"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onDecline}
              disabled={busy}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Working…" : "Confirm decline"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {/* ACCEPTED -> quote form; QUOTED -> revise */}
      {(actions.includes("quote") || actions.includes("revise_quote")) ? (
        <form onSubmit={onSubmitQuote} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          {status === "quoted" && !showQuote ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-700">
                Your quote is in. The owner will confirm a date.
              </p>
              <button
                type="button"
                onClick={() => setShowQuote(true)}
                className="text-sm font-semibold underline"
                style={{ color: "var(--brand-color)" }}
              >
                Revise
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-900">
                {status === "quoted" ? "Revise your quote" : "Send your quote"}
              </p>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700">Amount (CAD)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={quote}
                  onChange={(e) => setQuote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                  placeholder="e.g. 250"
                />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700">
                  Earliest date you can come (optional)
                </label>
                <input
                  type="date"
                  value={proposedDate}
                  onChange={(e) => setProposedDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700">Note (optional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                  placeholder="What the quote covers"
                />
              </div>
              <button
                type="submit"
                disabled={busy || quote.trim() === ""}
                className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: brandBg }}
              >
                {busy ? "Sending…" : status === "quoted" ? "Update quote" : "Send quote"}
              </button>
            </>
          )}
        </form>
      ) : null}
    </div>
  );
}
