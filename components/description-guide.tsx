"use client";

import { useMemo, useState } from "react";
import {
  DESCRIPTION_SECTIONS,
  buildDescriptionDraft,
  capturedSummaryLine,
  flagAnswers,
  flagDiscriminatoryLanguage,
  isDescriptionBlank,
  type DraftFacts,
  type GuidedAnswers,
} from "@/lib/listing-description";

// The Listing Description Helper (Noam's spec, 2026-06-18). The structured
// filters cover the checkbox facts; this guides the operator through the
// persuasive detail filters can't hold - layout, light, flow, features,
// building, neighbourhood, lifestyle fit - then assembles a strong, fair-housing
// -safe STARTER draft from those answers plus the structured fields. Plain
// language, not framed as "AI." Keeps name="description" so the existing server
// action saves it. Generation is deterministic (no AI key/cost); the
// tone-rewrite + channel-variant layer in the spec is a later add.
export function DescriptionGuide({
  defaultValue,
  facts,
}: {
  defaultValue: string;
  facts: DraftFacts;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<GuidedAnswers>({});
  const [preview, setPreview] = useState<string | null>(null);

  const capturedLine = useMemo(() => capturedSummaryLine(facts), [facts]);
  const answerFlags = useMemo(() => flagAnswers(answers), [answers]);
  const previewFlags = useMemo(
    () => (preview ? flagDiscriminatoryLanguage(preview) : []),
    [preview],
  );
  const flags = preview ? previewFlags : answerFlags;

  function setAnswer(key: string, v: string) {
    setAnswers((prev) => ({ ...prev, [key]: v }));
  }
  function generate() {
    setPreview(buildDescriptionDraft(facts, answers));
  }
  function useDraft() {
    if (preview) setValue(preview);
    setPreview(null);
    setOpen(false);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-xs font-medium text-gray-600">
          Description
        </label>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-medium text-indigo-600 hover:underline"
        >
          {open ? "Hide helper" : "Help me write this"}
        </button>
      </div>
      <textarea
        name="description"
        rows={5}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Bright 2-bedroom with in-suite laundry, close to transit…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      {isDescriptionBlank(value) && !open && (
        <p className="mt-1 text-xs text-gray-400">
          Structured fields cover the basics. The description is where you
          explain why the unit feels good to live in.{" "}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-medium text-indigo-600 hover:underline"
          >
            Help me write this
          </button>
        </p>
      )}

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-xs text-gray-600">
          <p className="text-gray-700">
            Answer a few quick prompts and we&apos;ll draft a clear rental
            description. Skip anything that doesn&apos;t apply.
          </p>
          {capturedLine && <p className="text-gray-500">{capturedLine}</p>}

          {DESCRIPTION_SECTIONS.map((s) => (
            <div key={s.key}>
              <label className="block font-medium text-gray-700">
                {s.title}
              </label>
              <p className="mb-1 text-gray-500">{s.prompt}</p>
              <textarea
                rows={2}
                value={answers[s.placeholder] ?? ""}
                onChange={(e) => setAnswer(s.placeholder, e.target.value)}
                placeholder={`e.g. ${s.examples.slice(0, 3).join("; ")}`}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
              />
              {s.complianceNote && (
                <p className="mt-0.5 text-amber-700">{s.complianceNote}</p>
              )}
            </div>
          ))}

          {flags.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-800">
              <p className="font-medium">
                Please rephrase before using - this could breach fair-housing
                rules:
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {flags.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium">“{f.match}”</span> -{" "}
                    {f.suggestion}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={generate}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-700"
            >
              {preview ? "Regenerate" : "Generate starter draft"}
            </button>
          </div>

          {preview && (
            <div className="space-y-2">
              <p className="font-medium text-gray-700">Starter draft</p>
              <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-2 font-sans text-xs text-gray-800">
                {preview}
              </pre>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={useDraft}
                  className="rounded-lg bg-green-600 px-2.5 py-1 font-medium text-white hover:bg-green-700"
                >
                  Use this description
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50"
                >
                  Keep my original
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
