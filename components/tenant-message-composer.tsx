"use client";

// The landlord -> tenant message composer on the tenancy detail page (platform
// pivot step 3). A small client component over the server action
// `sendTenantMessage`: pick a channel, optionally load a saved template (which
// fills channel + subject + body), edit, choose recipients, send. All the real
// logic — fan-out, recipient resolution, token substitution — is server-side in
// lib/tenant-comms; this is just the form state.

import { useMemo, useState } from "react";
import {
  MESSAGE_CHANNELS,
  channelLabel,
  channelIncludesEmail,
  channelIncludesSms,
  type MessageChannel,
} from "@/lib/tenant-comms";

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

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function TenantMessageComposer({
  tenancyId,
  tenants,
  templates,
  smsAllowed = true,
  sendAction,
}: {
  tenancyId: string;
  tenants: ComposerTenant[];
  templates: ComposerTemplate[];
  // Whether the org's plan includes SMS (S214 tier gate). When false the SMS /
  // Email+Text channels are shown locked and an upgrade nudge replaces them; the
  // server action enforces the same gate, so this is UX, not the security check.
  smsAllowed?: boolean;
  sendAction: (formData: FormData) => void | Promise<void>;
}) {
  const [channel, setChannel] = useState<MessageChannel>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(tenants.map((t) => t.id)),
  );
  const [templateId, setTemplateId] = useState("");

  const showSubject = channelIncludesEmail(channel);
  const usesEmail = channelIncludesEmail(channel);
  const usesSms = channelIncludesSms(channel);

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

  return (
    <form action={sendAction} className="space-y-4">
      <input type="hidden" name="tenancy_id" value={tenancyId} />
      <input type="hidden" name="channel" value={channel} />

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
          <p className="mt-2 text-xs text-gray-500">
            Texting tenants is part of a higher plan.{" "}
            <a href="/dashboard/billing" className="font-medium text-brand hover:underline">
              Upgrade to enable texts
            </a>
            . Email is included on your plan.
          </p>
        )}
      </div>

      {/* Subject (email only) */}
      {showSubject && (
        <div>
          <label className={labelCls}>Subject</label>
          <input
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Rent reminder for {{property_address}}"
            className={inputCls}
          />
        </div>
      )}

      {/* Body */}
      <div>
        <label className={labelCls}>Message</label>
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder={"Hi {{first_name}},\n\n..."}
          className={inputCls}
        />
        <span className="mt-1 block text-xs text-gray-400">
          Tokens: {"{{first_name}}"}, {"{{full_name}}"}, {"{{property_address}}"},{" "}
          {"{{org_name}}"}, {"{{rent}}"} — filled in per tenant.
          {usesSms && " Texts add a 'Reply STOP to opt out' line automatically."}
        </span>
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

      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        style={{ background: "var(--brand-gradient, var(--brand-color))" }}
      >
        Send message
      </button>
    </form>
  );
}
