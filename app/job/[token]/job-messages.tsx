"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { tradeDispatchErrorMessage } from "@/lib/work-order-dispatch";
import {
  canPostDispatchMessage,
  tradeSenderLabel,
  MAX_DISPATCH_MESSAGE_LEN,
  type DispatchMessage,
} from "@/lib/dispatch-messages";
import { postDispatchQuestion } from "./actions";

// Trade-side message thread for /job/[token] (S329 — "ask a question"). The trade
// can ask a clarifying question BEFORE accepting instead of phoning off-platform;
// the operator replies from their dashboard and the trade sees it here. Text only,
// no money, no state change. The ask box hides once the dispatch is terminal
// (canPostDispatchMessage) — the thread stays visible read-only.
export function JobMessages({
  token,
  status,
  orgName,
  brandBg,
  messages,
}: {
  token: string;
  status: string;
  orgName: string;
  brandBg: string;
  messages: DispatchMessage[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPost = canPostDispatchMessage(status);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim() === "") return;
    setBusy(true);
    setError(null);
    const res = await postDispatchQuestion({ token, body });
    setBusy(false);
    if (!res.ok) {
      setError(tradeDispatchErrorMessage(res.reason));
      return;
    }
    setBody("");
    router.refresh();
  }

  // Nothing to show and nothing to do (terminal + no history): render nothing.
  if (messages.length === 0 && !canPost) return null;

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-gray-900">Questions</p>
      <p className="mt-1 text-xs text-gray-500">
        Need to check something before you commit? Ask {orgName} here.
      </p>

      {messages.length > 0 ? (
        <div className="mt-4 space-y-3">
          {messages.map((m) => {
            const mine = m.sender === "trade";
            return (
              <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm " +
                    (mine
                      ? "bg-gray-100 text-gray-800"
                      : "border border-gray-200 bg-white text-gray-800")
                  }
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    {tradeSenderLabel(m.sender, orgName)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {canPost ? (
        <form onSubmit={onSend} className="mt-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={MAX_DISPATCH_MESSAGE_LEN}
            className="w-full rounded-lg border border-gray-300 p-2 text-sm"
            placeholder="e.g. Where's the water shutoff? Is there parking on site?"
          />
          <button
            type="submit"
            disabled={busy || body.trim() === ""}
            className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: brandBg }}
          >
            {busy ? "Sending…" : "Send question"}
          </button>
        </form>
      ) : messages.length > 0 ? (
        <p className="mt-4 text-xs text-gray-400">This job is closed. Messages are read-only.</p>
      ) : null}
    </div>
  );
}
