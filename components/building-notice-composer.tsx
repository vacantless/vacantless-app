"use client";

// The OUTBOUND building-notice composer (S321). A small client component over
// the server action `sendBuildingNotice`: pick a building (which reloads the
// page with that building's recipients), optionally start from the
// scheduled-work template, draft a subject / message / "what to expect" line,
// preview the resolved message, and send to every tenant in the building by
// email. All the real logic — recipient resolution, body composition, token
// substitution — is server-side in lib/building-notices + lib/tenant-comms; this
// is just the form state. Guardrail-neutral: operator -> tenant, email only.

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { renderForRecipient } from "@/lib/tenant-comms";
import {
  composeNoticeBody,
  SCHEDULED_WORK_TEMPLATE,
  type BuildingOption,
  type BuildingDeliveryTally,
} from "@/lib/building-notices";

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

// Click-to-insert personalization chips (same tokens the per-tenancy composer
// offers, minus rent which is irrelevant to a building-wide notice).
const TOKEN_CHIPS: { token: string; label: string }[] = [
  { token: "first_name", label: "First name" },
  { token: "property_address", label: "Property address" },
  { token: "org_name", label: "Your business name" },
];

export default function BuildingNoticeComposer({
  buildingOptions,
  selectedBuildingKey,
  summary,
  sampleAddress,
  orgName,
  orgContactEmail = null,
  orgContactPhone = null,
  sendAction,
}: {
  buildingOptions: BuildingOption[];
  selectedBuildingKey: string | null;
  // The reachability tally for the selected building (null until one is picked).
  summary: BuildingDeliveryTally | null;
  // A real unit address from the building, used to resolve {{property_address}}
  // in the preview so the operator sees the real outgoing message.
  sampleAddress: string | null;
  orgName: string | null;
  orgContactEmail?: string | null;
  orgContactPhone?: string | null;
  sendAction: (formData: FormData) => void | Promise<void>;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [impact, setImpact] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [lastFocused, setLastFocused] = useState<"subject" | "body">("body");

  function onPickBuilding(key: string) {
    const url = key
      ? `/dashboard/maintenance/notices?building=${encodeURIComponent(key)}`
      : "/dashboard/maintenance/notices";
    router.push(url);
  }

  function insertToken(tok: string) {
    const snippet = `{{${tok}}}`;
    const intoSubject = lastFocused === "subject";
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

  function applyTemplate() {
    setSubject(SCHEDULED_WORK_TEMPLATE.subject);
    setBody(SCHEDULED_WORK_TEMPLATE.body);
    setImpact(SCHEDULED_WORK_TEMPLATE.impact);
  }

  const previewCtx = {
    tenantName: null,
    orgName,
    propertyAddress: sampleAddress,
    rentCents: null,
    orgContactEmail,
    orgContactPhone,
  };
  const previewSubject = useMemo(
    () => renderForRecipient(subject, previewCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject, orgName, sampleAddress, orgContactEmail, orgContactPhone],
  );
  const previewBody = useMemo(
    () => renderForRecipient(composeNoticeBody(body, impact), previewCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body, impact, orgName, sampleAddress, orgContactEmail, orgContactPhone],
  );

  const hasContent = subject.trim().length > 0 && body.trim().length > 0;
  const canSend = !!selectedBuildingKey && !!summary && summary.sendable > 0 && hasContent;

  return (
    <form action={sendAction} className="space-y-4">
      <input type="hidden" name="building_key" value={selectedBuildingKey ?? ""} />

      {/* Building picker */}
      <div>
        <label className={labelCls}>Building</label>
        <select
          value={selectedBuildingKey ?? ""}
          onChange={(e) => onPickBuilding(e.target.value)}
          className={inputCls}
        >
          <option value="">— Choose a building —</option>
          {buildingOptions.map((o) => (
            <option key={o.buildingKey} value={o.buildingKey}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {!selectedBuildingKey && (
        <p className="text-sm text-gray-500">
          Pick a building to notify its tenants.
        </p>
      )}

      {selectedBuildingKey && summary && (
        <>
          {/* Reachability summary */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            This notice will email{" "}
            <strong>
              {summary.sendable} {summary.sendable === 1 ? "tenant" : "tenants"}
            </strong>{" "}
            across {summary.tenancyCount}{" "}
            {summary.tenancyCount === 1 ? "tenancy" : "tenancies"}.
            {summary.skipped > 0 && (
              <span className="text-amber-600">
                {" "}
                {summary.skipped} will be skipped (no email on file).
              </span>
            )}
            {summary.sendable === 0 && (
              <span className="text-amber-600">
                {" "}
                No tenants here have an email address yet, so there&rsquo;s nobody
                to send to.
              </span>
            )}
          </div>

          {/* Start from template */}
          <button
            type="button"
            onClick={applyTemplate}
            className="rounded-lg border border-brand/40 bg-white px-3 py-1.5 text-sm font-medium text-brand transition hover:bg-brand/5"
          >
            Start from the scheduled-work template
          </button>

          {/* Subject */}
          <div>
            <label className={labelCls}>Subject</label>
            <input
              ref={subjectRef}
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={() => setLastFocused("subject")}
              placeholder="e.g. Scheduled electrical work this Thursday"
              className={inputCls}
            />
          </div>

          {/* Body */}
          <div>
            <label className={labelCls}>Message</label>
            <textarea
              ref={bodyRef}
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={() => setLastFocused("body")}
              rows={7}
              placeholder={"Hi there,\n\nWe're letting all residents know about scheduled work in the building..."}
              className={inputCls}
            />
            <div className="mt-2">
              <span className="mb-1 block text-xs text-gray-500">
                Insert a detail (fills in automatically for each tenant):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {TOKEN_CHIPS.map((chip) => (
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
            </div>
          </div>

          {/* Impact / what to expect */}
          <div>
            <label className={labelCls}>
              What to expect (optional)
            </label>
            <input
              name="impact"
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              placeholder="e.g. Power may be out 9 a.m. - 12 p.m."
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-gray-400">
              If filled in, this is added to the notice under a &ldquo;What to
              expect&rdquo; heading.
            </span>
          </div>

          {/* Preview */}
          <div>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              disabled={!hasContent}
              className="text-sm font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
            >
              {showPreview ? "Hide preview" : "Preview notice"}
            </button>
            {!hasContent && (
              <span className="ml-2 text-xs text-gray-400">
                Add a subject and message to preview.
              </span>
            )}
            {showPreview && hasContent && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="mb-2 text-xs text-gray-500">
                  This is what each tenant receives, with their details filled in.
                </p>
                <p className="text-sm text-gray-900">
                  <span className="text-gray-500">Subject: </span>
                  {previewSubject || (
                    <span className="italic text-gray-400">(no subject)</span>
                  )}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                  {previewBody}
                </p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Send notice
          </button>
        </>
      )}
    </form>
  );
}
