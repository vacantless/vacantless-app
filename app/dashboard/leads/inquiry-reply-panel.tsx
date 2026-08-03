"use client";

import { useState } from "react";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import type { AiReplyDraft } from "@/lib/ai-reply";
import { addLeadPropertyQa } from "./actions";

export function InquiryReplyPanel({
  leadId,
  propertyId,
  email,
  phone,
  subject,
  body,
  aiDraft,
  suggestedQuestion,
  canCapture,
}: {
  leadId: string;
  propertyId: string | null;
  email: string | null;
  phone: string | null;
  subject: string;
  body: string;
  aiDraft?: AiReplyDraft | null;
  suggestedQuestion?: string | null;
  canCapture: boolean;
}) {
  const [subjectText, setSubjectText] = useState(subject);
  const [text, setText] = useState(body);
  const [captureAnswer, setCaptureAnswer] = useState("");
  const [copied, setCopied] = useState(false);
  const [drafted, setDrafted] = useState(false);

  const mailto = email
    ? `mailto:${email}?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(text)}`
    : undefined;

  function onAiDraft() {
    if (!aiDraft) return;
    setSubjectText(aiDraft.subject);
    setText(aiDraft.body);
    setDrafted(true);
    setCopied(false);
  }

  async function onCopy() {
    if (await copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div
      id="reply"
      className="mt-8 scroll-mt-6 rounded-2xl border border-brand/30 bg-brand/5 p-4"
    >
      <h3 className="text-sm font-semibold text-gray-900">
        Reply to this renter
      </h3>
      <p className="mb-2 text-xs text-gray-500">
        Edit the message, then send it from your own email or copy it. Nothing
        is sent automatically.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        aria-label="Reply message"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {aiDraft ? (
          <button
            type="button"
            onClick={onAiDraft}
            className="rounded-lg border border-brand/30 bg-white px-3 py-2 text-sm font-medium text-brand hover:bg-brand/5"
          >
            {drafted ? "AI draft added" : "AI draft"}
          </button>
        ) : null}
        {mailto ? (
          <a
            href={mailto}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            Open in email
          </a>
        ) : (
          <span className="text-xs text-gray-500">
            No email on file{phone ? `. Call ${phone}.` : "."}
          </span>
        )}
        <button
          type="button"
          onClick={onCopy}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {copied ? "Copied!" : "Copy message"}
        </button>
        {drafted ? (
          <span className="text-xs text-gray-500">
            Review the draft before opening or copying.
          </span>
        ) : null}
      </div>
      {canCapture && propertyId ? (
        <details className="mt-4 rounded-xl border border-gray-200 bg-white/80 shadow-sm">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-800">
            Save an answer for next time
          </summary>
          <form
            action={addLeadPropertyQa}
            className="space-y-3 border-t border-gray-100 px-4 py-4"
          >
            <input type="hidden" name="lead_id" value={leadId} />
            <input type="hidden" name="property_id" value={propertyId} />
            <input type="hidden" name="scope" value="property" />
            <input type="hidden" name="source" value="auto" />
            <div>
              <label
                htmlFor="qa-capture-question"
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Question
              </label>
              <input
                id="qa-capture-question"
                name="question_text"
                defaultValue={suggestedQuestion ?? ""}
                placeholder="e.g. Is parking available?"
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="qa-capture-answer"
                  className="block text-xs font-medium text-gray-600"
                >
                  Answer
                </label>
                <button
                  type="button"
                  onClick={() => setCaptureAnswer(text)}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Use my reply
                </button>
              </div>
              <textarea
                id="qa-capture-answer"
                name="answer_text"
                value={captureAnswer}
                onChange={(e) => setCaptureAnswer(e.target.value)}
                rows={4}
                placeholder="Write the exact answer the draft can reuse next time."
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
              >
                Save answer
              </button>
              <p className="text-xs text-gray-500">
                Saved as a reusable answer for this rental. You can edit or
                delete it in &quot;Answers the AI can use&quot; above.
              </p>
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}
