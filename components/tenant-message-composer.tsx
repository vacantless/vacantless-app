"use client";

// The landlord -> tenant message composer on the tenancy detail page (platform
// pivot step 3). A small client component over the server action
// `sendTenantMessage`: pick a channel, optionally load a saved template (which
// fills channel + subject + body), edit, choose recipients, send. All the real
// logic — fan-out, recipient resolution, token substitution — is server-side in
// lib/tenant-comms; this is just the form state.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import {
  MESSAGE_CHANNELS,
  channelLabel,
  channelIncludesEmail,
  channelIncludesSms,
  commsErrorMessage,
  renderForRecipient,
  buildTenantSmsBody,
  type MessageChannel,
} from "@/lib/tenant-comms";
import { FeatureLockedNotice } from "@/components/feature-locked-notice";

export type ComposerTenant = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  sms_opt_out: boolean;
};

export type ComposerTemplate = {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
};

type UndoPayload = {
  tenancyId: string;
  channel: string;
  subject: string | null;
  body: string;
  recipientIds: string[];
};

type EnqueueUndoAction = (
  payload: UndoPayload,
) => Promise<{ ok: true; id: string } | { ok: false; code: string }>;
type FlushScheduledAction = (
  id: string,
) => Promise<{
  ok: boolean;
  outcome: "sent" | "failed" | "noone" | "already" | "disabled";
  sent?: number;
  failed?: number;
  skipped?: number;
}>;
type CancelScheduledAction = (id: string) => Promise<{ ok: boolean; canceled: boolean }>;

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

// Friendly, click-to-insert personalization fields (S283). Each chip drops the
// underlying {{token}} at the cursor so the operator never has to type curly
// braces — the tokens still resolve per-tenant server-side via tokenVarsFor.
const TOKEN_CHIPS: { token: string; label: string }[] = [
  { token: "first_name", label: "First name" },
  { token: "full_name", label: "Full name" },
  { token: "property_address", label: "Property address" },
  { token: "org_name", label: "Your business name" },
  { token: "rent", label: "Rent amount" },
];

// Contact-detail chips are only offered when the org has actually set the value
// (Settings -> Public Page & Brand), so an operator never inserts a token that
// would resolve to an empty string.
const CONTACT_CHIPS: { token: string; label: string }[] = [
  { token: "business_email", label: "Your email" },
  { token: "business_phone", label: "Your phone" },
];

function localDateTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoFromLocalInput(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export default function TenantMessageComposer({
  tenancyId,
  tenants,
  templates,
  smsAllowed = true,
  orgName,
  propertyAddress,
  rentCents,
  orgContactEmail = null,
  orgContactPhone = null,
  initialTemplateId = null,
  initialDetails = null,
  sendAction,
  schedulingEnabled = false,
  undoSeconds = 30,
  enqueueUndoAction,
  flushScheduledAction,
  cancelScheduledAction,
}: {
  tenancyId: string;
  tenants: ComposerTenant[];
  templates: ComposerTemplate[];
  // Whether the org's plan includes SMS (S214 tier gate). When false the SMS /
  // Email+Text channels are shown locked and an upgrade nudge replaces them; the
  // server action enforces the same gate, so this is UX, not the security check.
  smsAllowed?: boolean;
  // Context used to RESOLVE {{tokens}} in the live preview, so the operator sees
  // the real outgoing message before sending (QA blocker #3). Mirrors the
  // server's tokenVarsFor inputs exactly via the shared pure renderForRecipient.
  orgName: string | null;
  propertyAddress: string | null;
  rentCents: number | null;
  // Org public contact details (migration 0043). Drive the {{business_email}} /
  // {{business_phone}} chips + preview; null when unset (chip then hidden).
  orgContactEmail?: string | null;
  orgContactPhone?: string | null;
  // When the composer is deep-linked from a work-order status change (Slice 4),
  // this is the saved-template id to pre-load so the operator lands on a ready
  // maintenance update. null = open blank, the normal case.
  initialTemplateId?: string | null;
  // A plain-text details block (the work order's quote + expected window) to
  // append to the body once on deep-link (Slice 4). Appended AFTER any initial
  // template so the operator lands on a ready note with the concrete numbers in.
  initialDetails?: string | null;
  sendAction: (formData: FormData) => void | Promise<void>;
  schedulingEnabled?: boolean;
  undoSeconds?: number;
  enqueueUndoAction?: EnqueueUndoAction;
  flushScheduledAction?: FlushScheduledAction;
  cancelScheduledAction?: CancelScheduledAction;
}) {
  const [channel, setChannel] = useState<MessageChannel>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(tenants.map((t) => t.id)),
  );
  const [templateId, setTemplateId] = useState("");
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [undoState, setUndoState] = useState<{
    id: string;
    deadlineMs: number;
    remaining: number;
    flushing: boolean;
  } | null>(null);
  const [inlineNotice, setInlineNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Token chip insertion — drop {{token}} at the cursor of whichever field the
  // operator last touched (defaults to the body), then restore focus + caret.
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [lastFocused, setLastFocused] = useState<"subject" | "body">("body");

  function insertToken(tok: string) {
    const snippet = `{{${tok}}}`;
    const intoSubject = lastFocused === "subject" && channelIncludesEmail(channel);
    const target = intoSubject ? subjectRef.current : bodyRef.current;
    const current = intoSubject ? subject : body;
    const setValue = intoSubject ? setSubject : setBody;
    const start = target?.selectionStart ?? current.length;
    const end = target?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + snippet + current.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      const el = intoSubject ? subjectRef.current : bodyRef.current;
      if (!el) return;
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const showSubject = channelIncludesEmail(channel);
  const usesEmail = channelIncludesEmail(channel);
  const usesSms = channelIncludesSms(channel);

  // The personalization chips on offer: the always-available tokens plus any
  // contact-detail chip whose value the org has actually set (so a chip never
  // inserts a token that would resolve to an empty string).
  const chips = useMemo(() => {
    const contactSet: Record<string, boolean> = {
      business_email: !!(orgContactEmail ?? "").trim(),
      business_phone: !!(orgContactPhone ?? "").trim(),
    };
    return [...TOKEN_CHIPS, ...CONTACT_CHIPS.filter((c) => contactSet[c.token])];
  }, [orgContactEmail, orgContactPhone]);

  // A channel is locked when it needs SMS but the plan doesn't include it.
  function channelLocked(c: MessageChannel): boolean {
    return !smsAllowed && channelIncludesSms(c);
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    if ((MESSAGE_CHANNELS as readonly string[]).includes(tpl.channel)) {
      const tplChannel = tpl.channel as MessageChannel;
      // Don't auto-select a locked channel from a template — fall back to email
      // (the body/subject still apply). The plan gate stays intact.
      setChannel(channelLocked(tplChannel) ? "email" : tplChannel);
    }
    setSubject(tpl.subject ?? "");
    setBody(tpl.body);
  }

  // Pre-load a template + append the work-order details when deep-linked from a
  // status change (Slice 4). Runs ONCE. If the template was renamed/deleted, the
  // template step is a no-op and the composer just opens with the details block
  // (or blank). The detail block is appended AFTER the template body via a
  // functional setBody so it lands on top of the freshly-applied template text.
  // The operator can still change everything before sending.
  const appliedInitial = useRef(false);
  useEffect(() => {
    if (appliedInitial.current) return;
    if (!initialTemplateId && !initialDetails) return;
    appliedInitial.current = true;
    if (initialTemplateId && templates.some((t) => t.id === initialTemplateId)) {
      applyTemplate(initialTemplateId);
    }
    const details = (initialDetails ?? "").trim();
    if (details) {
      setBody((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${details}` : details));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplateId, initialDetails]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Per-tenant reachability note for the chosen channel, so the operator sees
  // who actually gets reached before sending. Mirrors the server's plan logic.
  function reachNote(t: ComposerTenant): { ok: boolean; text: string } {
    const parts: string[] = [];
    let anyOk = false;
    if (usesEmail) {
      if (t.email) {
        parts.push(t.email);
        anyOk = true;
      } else parts.push("no email");
    }
    if (usesSms) {
      if (t.sms_opt_out) parts.push("texts opted out");
      else if (t.phone) {
        parts.push(t.phone);
        anyOk = true;
      } else parts.push("no phone");
    }
    return { ok: anyOk, text: parts.join(" · ") || "no contact details" };
  }

  const selectedCount = useMemo(
    () => tenants.filter((t) => selected.has(t.id)).length,
    [tenants, selected],
  );

  const [showPreview, setShowPreview] = useState(false);

  // Resolve {{tokens}} per selected recipient using the SAME pure renderer the
  // server uses, so "what the operator previews" === "what the tenant gets".
  // For texts we also fold in the auto-appended opt-out line via buildTenantSmsBody.
  const previews = useMemo(() => {
    return tenants
      .filter((t) => selected.has(t.id))
      .map((t) => {
        const ctx = {
          tenantName: t.name,
          orgName,
          propertyAddress,
          rentCents,
          orgContactEmail,
          orgContactPhone,
        };
        const emailBody = renderForRecipient(body, ctx);
        return {
          id: t.id,
          name: t.name || "Unnamed tenant",
          subject: usesEmail ? renderForRecipient(subject, ctx) : null,
          emailBody: usesEmail ? emailBody : null,
          smsBody: usesSms ? buildTenantSmsBody(emailBody, orgName) : null,
        };
      });
  }, [tenants, selected, body, subject, usesEmail, usesSms, orgName, propertyAddress, rentCents, orgContactEmail, orgContactPhone]);

  const hasContent =
    body.trim().length > 0 || (usesEmail && subject.trim().length > 0);

  const schedulingReady =
    schedulingEnabled && !!enqueueUndoAction && !!flushScheduledAction && !!cancelScheduledAction;
  const scheduleBounds = useMemo(() => {
    const min = new Date(Date.now() + 60 * 1000);
    const max = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    return {
      min: localDateTimeValue(min),
      max: localDateTimeValue(max),
    };
  }, []);
  const scheduledIso = isoFromLocalInput(scheduledLocal);

  function messageUrl(outcome: "sent" | "failed" | "noone", counts: {
    sent?: number;
    failed?: number;
    skipped?: number;
  }) {
    const s = counts.sent ?? 0;
    const f = counts.failed ?? 0;
    const k = counts.skipped ?? 0;
    return `/dashboard/tenancies/${tenancyId}?msg=${outcome}&s=${s}&k=${k}&f=${f}#message`;
  }

  function flushUndo(id: string) {
    if (!flushScheduledAction) {
      setInlineNotice("Could not send from the outbox. Refresh and try again.");
      return;
    }
    setUndoState((current) =>
      current?.id === id ? { ...current, flushing: true, remaining: 0 } : current,
    );
    startTransition(() => {
      void (async () => {
        const result = await flushScheduledAction(id);
        if (
          result.outcome === "sent" ||
          result.outcome === "failed" ||
          result.outcome === "noone"
        ) {
          window.location.assign(messageUrl(result.outcome, result));
          return;
        }
        setUndoState(null);
        setInlineNotice(
          result.outcome === "already"
            ? "This message was already handled."
            : "Could not send from the outbox. Refresh and try again.",
        );
      })();
    });
  }

  useEffect(() => {
    if (!undoState || undoState.flushing) return;
    const id = undoState.id;
    const deadlineMs = undoState.deadlineMs;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      setUndoState((current) =>
        current?.id === id ? { ...current, remaining } : current,
      );
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    const timeout = window.setTimeout(
      () => flushUndo(id),
      Math.max(0, deadlineMs - Date.now()),
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoState?.id, undoState?.deadlineMs, undoState?.flushing]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const enqueue = enqueueUndoAction;
    if (!schedulingReady || !enqueue || sendMode !== "now") return;
    event.preventDefault();
    if (undoState || isPending) return;

    setInlineNotice(null);
    startTransition(() => {
      void (async () => {
        const result = await enqueue({
          tenancyId,
          channel,
          subject,
          body,
          recipientIds: Array.from(selected),
        });
        if (!result.ok) {
          setInlineNotice(commsErrorMessage(result.code) ?? "Check the message and try again.");
          return;
        }
        setUndoState({
          id: result.id,
          deadlineMs: Date.now() + undoSeconds * 1000,
          remaining: undoSeconds,
          flushing: false,
        });
      })();
    });
  }

  function cancelUndo(id: string) {
    if (!cancelScheduledAction) return;
    startTransition(() => {
      void (async () => {
        const result = await cancelScheduledAction(id);
        if (result.canceled) {
          setUndoState(null);
          setInlineNotice("Message canceled.");
          return;
        }
        setInlineNotice("Too late to cancel - the message is already being sent.");
      })();
    });
  }

  return (
    <form action={sendAction} onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="tenancy_id" value={tenancyId} />
      <input type="hidden" name="channel" value={channel} />
      {schedulingEnabled && <input type="hidden" name="send_mode" value={sendMode} />}
      {schedulingEnabled && sendMode === "later" && (
        <input type="hidden" name="scheduled_send_at" value={scheduledIso} />
      )}

      {/* Template picker (optional) */}
      {templates.length > 0 && (
        <div>
          <label className={labelCls}>Start from a saved template (optional)</label>
          <select
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            className={inputCls}
          >
            <option value="">— Write a one-off message —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({channelLabel(t.channel)})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Channel */}
      <div>
        <label className={labelCls}>Send by</label>
        <div className="flex flex-wrap gap-2">
          {MESSAGE_CHANNELS.map((c) => {
            const locked = channelLocked(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => !locked && setChannel(c)}
                disabled={locked}
                aria-disabled={locked}
                title={locked ? "Texting tenants is part of a higher plan" : undefined}
                className={
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition " +
                  (locked
                    ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                    : channel === c
                      ? "border-transparent bg-gray-900 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50")
                }
              >
                {channelLabel(c)}
                {locked && " 🔒"}
              </button>
            );
          })}
        </div>
        {!smsAllowed && (
          <div className="mt-3">
            <FeatureLockedNotice
              title="Texting tenants is part of a higher plan"
              description="Email is included on your plan. Upgrade to message tenants by text as well."
              unlockTier="growth"
            />
          </div>
        )}
      </div>

      {schedulingEnabled && (
        <div>
          <label className={labelCls}>When to send</label>
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm font-medium">
            <button
              type="button"
              onClick={() => setSendMode("now")}
              className={
                "px-3 py-1.5 transition " +
                (sendMode === "now"
                  ? "bg-gray-900 text-white"
                  : "text-gray-700 hover:bg-gray-50")
              }
            >
              Send now
            </button>
            <button
              type="button"
              onClick={() => setSendMode("later")}
              className={
                "border-l border-gray-300 px-3 py-1.5 transition " +
                (sendMode === "later"
                  ? "bg-gray-900 text-white"
                  : "text-gray-700 hover:bg-gray-50")
              }
            >
              Send later
            </button>
          </div>
          {sendMode === "later" && (
            <div className="mt-3 max-w-xs">
              <input
                type="datetime-local"
                value={scheduledLocal}
                min={scheduleBounds.min}
                max={scheduleBounds.max}
                onChange={(e) => setScheduledLocal(e.target.value)}
                className={inputCls}
              />
            </div>
          )}
        </div>
      )}

      {/* Subject (email only) */}
      {showSubject && (
        <div>
          <label className={labelCls}>Subject</label>
          <input
            ref={subjectRef}
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onFocus={() => setLastFocused("subject")}
            placeholder="e.g. Rent reminder for your home"
            className={inputCls}
          />
        </div>
      )}

      {/* Body */}
      <div>
        <label className={labelCls}>Message</label>
        <textarea
          ref={bodyRef}
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => setLastFocused("body")}
          rows={5}
          placeholder={"Hi there,\n\n..."}
          className={inputCls}
        />
        <div className="mt-2">
          <span className="mb-1 block text-xs text-gray-500">
            Insert a detail (fills in automatically for each tenant):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.token}
                type="button"
                onClick={() => insertToken(chip.token)}
                className="rounded-md border border-brand/40 bg-white px-2 py-0.5 text-xs font-medium text-brand transition hover:bg-brand/5"
              >
                + {chip.label}
              </button>
            ))}
          </div>
          {usesSms && (
            <span className="mt-1 block text-xs text-gray-400">
              Texts add a &ldquo;Reply STOP to opt out&rdquo; line automatically.
            </span>
          )}
        </div>
      </div>

      {/* Recipients */}
      <div>
        <label className={labelCls}>
          Recipients ({selectedCount} of {tenants.length})
        </label>
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
          {tenants.map((t) => {
            const note = reachNote(t);
            const isSel = selected.has(t.id);
            return (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="recipient_ids"
                  value={t.id}
                  checked={isSel}
                  onChange={() => toggle(t.id)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="min-w-0 flex-1">
                  <span className="text-gray-900">{t.name || "Unnamed tenant"}</span>
                  <span
                    className={
                      "ml-2 block text-xs " +
                      (isSel && !note.ok ? "text-amber-600" : "text-gray-400")
                    }
                  >
                    {note.text}
                    {isSel && !note.ok ? " — will be skipped" : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Resolved preview — shows the real outgoing message (tokens filled in)
          per selected recipient before sending (QA blocker #3). */}
      <div>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          disabled={!hasContent || selectedCount === 0}
          className="text-sm font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
        >
          {showPreview ? "Hide preview" : "Preview message"}
        </button>
        {!hasContent && (
          <span className="ml-2 text-xs text-gray-400">
            Write a message to preview it.
          </span>
        )}
        {hasContent && selectedCount === 0 && (
          <span className="ml-2 text-xs text-gray-400">
            Select a recipient to preview.
          </span>
        )}

        {showPreview && hasContent && selectedCount > 0 && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-gray-500">
              This is exactly what each tenant will receive, with their details
              filled in.
            </p>
            {previews.map((pv) => (
              <div
                key={pv.id}
                className="rounded-xl border border-gray-200 bg-gray-50 p-3"
              >
                <p className="mb-2 text-xs font-semibold text-gray-700">
                  To {pv.name}
                </p>
                {pv.emailBody != null && (
                  <div className="mb-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                      Email
                    </p>
                    {pv.subject != null && (
                      <p className="text-sm text-gray-900">
                        <span className="text-gray-500">Subject: </span>
                        {pv.subject || (
                          <span className="italic text-gray-400">
                            (no subject)
                          </span>
                        )}
                      </p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                      {pv.emailBody || (
                        <span className="italic text-gray-400">
                          (empty message)
                        </span>
                      )}
                    </p>
                  </div>
                )}
                {pv.smsBody != null && (
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                      Text
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                      {pv.smsBody}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {inlineNotice && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {inlineNotice}
        </div>
      )}

      {undoState && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            {undoState.flushing
              ? "Sending now..."
              : `Sending in ${undoState.remaining}s`}
          </span>
          {!undoState.flushing && (
            <button
              type="button"
              onClick={() => cancelUndo(undoState.id)}
              disabled={isPending}
              className="font-semibold text-amber-950 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              Undo
            </button>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending || !!undoState}
        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        style={{ background: "var(--brand-gradient, var(--brand-color))" }}
      >
        {schedulingEnabled && sendMode === "later" ? "Schedule message" : "Send message"}
      </button>
    </form>
  );
}
