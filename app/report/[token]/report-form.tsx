"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
  reportErrorMessage,
  type IncidentCategory,
} from "@/lib/incident-reports";
import {
  validateMediaUpload,
  mediaUploadErrorMessage,
  formatBytes,
  MAX_MEDIA_PER_REPORT,
  ALLOWED_INCIDENT_MEDIA_TYPES,
} from "@/lib/incident-media";
import {
  createIncidentReport,
  prepareIncidentUpload,
  confirmIncidentMedia,
} from "./actions";

// The PRIVATE bucket id — canonical source is lib/incident-media-server
// (INCIDENT_MEDIA_BUCKET) + migration 0060. Kept as a literal here to avoid
// pulling a -server module into the client bundle.
const INCIDENT_MEDIA_BUCKET = "incident-media";

type PickedFile = { file: File; kind: "image" | "video" };

// Tenant incident-report capture (Option B Slice 2). Pure client interaction;
// the server actions + their SECURITY DEFINER RPCs re-validate everything. Media
// bytes go straight from the browser to a signed upload URL (never through a
// server action — a 25 MB video would exceed the serverless body limit).
export function ReportForm({
  token,
  brandBg,
  defaultName,
  defaultContact,
}: {
  token: string;
  brandBg: string;
  defaultName: string | null;
  defaultContact: string | null;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<IncidentCategory | "">("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState(defaultName ?? "");
  const [contact, setContact] = useState(defaultContact ?? "");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const ready = category !== "" && description.trim().length >= 3 && !submitting;

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const picked = Array.from(e.target.files ?? []);
    const next: PickedFile[] = [...files];
    for (const file of picked) {
      if (next.length >= MAX_MEDIA_PER_REPORT) {
        setFileError(`You can attach up to ${MAX_MEDIA_PER_REPORT} files.`);
        break;
      }
      const v = validateMediaUpload({ type: file.type, size: file.size });
      if (!v.ok) {
        setFileError(mediaUploadErrorMessage(v.reason));
        continue;
      }
      next.push({ file, kind: v.kind });
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(i: number) {
    setFiles((f) => f.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    setProgress("Sending your report…");

    // 1. create the report (text first).
    const created = await createIncidentReport({
      token,
      category: category as string,
      description,
      reporterName: name.trim() || null,
      reporterContact: contact.trim() || null,
    });
    if (!created.ok) {
      setSubmitting(false);
      setProgress(null);
      setError(reportErrorMessage(created.reason));
      return;
    }

    // 2. upload each file directly to a signed URL, then record it. A single
    // file failing does not lose the report — the operator still receives it.
    const supabase = createClient();
    let uploaded = 0;
    for (let i = 0; i < files.length; i++) {
      const { file, kind } = files[i];
      setProgress(`Uploading attachment ${i + 1} of ${files.length}…`);

      const prep = await prepareIncidentUpload({
        token,
        reportId: created.reportId,
        fileType: file.type,
        fileSize: file.size,
      });
      if (!prep.ok) continue;

      const up = await supabase.storage
        .from(INCIDENT_MEDIA_BUCKET)
        .uploadToSignedUrl(prep.path, prep.uploadToken, file);
      if (up.error) continue;

      const rec = await confirmIncidentMedia({
        token,
        reportId: created.reportId,
        path: prep.path,
        mimeType: file.type,
        sizeBytes: file.size,
        kind,
      });
      if (rec.ok) uploaded++;
    }
    void uploaded;

    router.push(`/report/${encodeURIComponent(token)}?submitted=1`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* Category */}
      <div>
        <label htmlFor="category" className="block text-sm font-semibold text-gray-800">
          What&apos;s the issue about?
        </label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as IncidentCategory)}
          className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-[var(--brand-color)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
          required
        >
          <option value="">Choose one…</option>
          {INCIDENT_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {INCIDENT_CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="block text-sm font-semibold text-gray-800">
          Describe what&apos;s happening
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder="e.g. The kitchen sink has been leaking under the cabinet since this morning."
          className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-[var(--brand-color)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
          required
        />
      </div>

      {/* Reporter identity */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="block text-sm font-semibold text-gray-800">
            Your name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-[var(--brand-color)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
          />
        </div>
        <div>
          <label htmlFor="contact" className="block text-sm font-semibold text-gray-800">
            Best way to reach you
          </label>
          <input
            id="contact"
            type="text"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Email or phone"
            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-[var(--brand-color)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
          />
        </div>
      </div>

      {/* Media */}
      <div>
        <p className="block text-sm font-semibold text-gray-800">
          Photos or a short video <span className="font-normal text-gray-500">(optional)</span>
        </p>
        {files.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {files.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="truncate text-gray-700">
                  {f.kind === "video" ? "🎬" : "🖼️"} {f.file.name}{" "}
                  <span className="text-gray-400">({formatBytes(f.file.size)})</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="ml-3 shrink-0 text-gray-400 hover:text-red-600"
                  aria-label="Remove file"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {fileError ? <p className="mt-2 text-sm text-red-600">{fileError}</p> : null}
        {files.length < MAX_MEDIA_PER_REPORT ? (
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 hover:border-gray-400">
            + Add photo or video
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_INCIDENT_MEDIA_TYPES.join(",")}
              multiple
              onChange={onPickFiles}
              className="hidden"
            />
          </label>
        ) : null}
        <p className="mt-1 text-xs text-gray-400">
          Photos up to 10 MB, videos up to 25 MB. Up to {MAX_MEDIA_PER_REPORT} files.
        </p>
      </div>

      <div>
        <button
          type="submit"
          disabled={!ready}
          className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: brandBg }}
        >
          {submitting ? (progress ?? "Sending…") : "Send report"}
        </button>
        {submitting && progress ? (
          <p className="mt-2 text-center text-xs text-gray-500">{progress}</p>
        ) : null}
      </div>
    </form>
  );
}
