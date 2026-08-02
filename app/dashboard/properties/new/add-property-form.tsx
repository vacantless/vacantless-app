"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import {
  buildChannelReadiness,
  type ChannelReadiness,
} from "@/lib/channel-readiness";
import {
  AC_TYPE_OPTIONS,
  AMENITY_KEYS,
  AMENITY_LABELS,
  DOG_SIZE_OPTIONS,
  HEATING_TYPE_LABELS,
  HEATING_TYPE_OPTIONS,
  LAUNDRY_OPTIONS,
  LEASE_TERM_OPTIONS,
  PARKING_TYPE_LABELS,
  PARKING_TYPE_OPTIONS,
  SMOKING_OPTIONS,
  STRUCTURE_TYPE_OPTIONS,
  UNIT_TYPE_OPTIONS,
  acTypeLabel,
  dogSizeLabel,
  laundryLabel,
  leaseTermLabel,
  smokingLabel,
  structureTypeLabel,
  unitTypeLabel,
} from "@/lib/property-features";
import { assembleDocumentText, type PdfTextItemLike } from "@/lib/pdf-text";
import {
  EMPTY_ADD_PROPERTY_V2_DRAFT,
  buildAddPropertyV2ReadinessInput,
  type AddPropertyV2Draft,
} from "@/lib/add-property-v2";
import {
  createPropertyV2,
  draftAddPropertyV2Description,
  prefillAddPropertyV2,
} from "../actions";

const PDF_WORKER_SRC = "/pdf.worker.min.mjs";
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 30;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_FILES = 4;
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

let workerConfigured = false;

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    workerConfigured = true;
  }
  return pdfjs;
}

function inputClass(extra = "") {
  return `w-full rounded-lg border border-gray-300 px-3 py-2 text-sm ${extra}`;
}

function selectClass(extra = "") {
  return `w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm ${extra}`;
}

function setValue<K extends keyof AddPropertyV2Draft>(
  current: AddPropertyV2Draft,
  key: K,
  value: AddPropertyV2Draft[K],
): AddPropertyV2Draft {
  return { ...current, [key]: value };
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </span>
      {children}
    </label>
  );
}

function ReadinessMeter({ entries }: { entries: ChannelReadiness[] }) {
  return (
    <aside className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:sticky lg:top-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Channel readiness
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            Missing items do not block saving a Draft.
          </p>
        </div>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          Live preview
        </span>
      </div>
      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.channel}
            className="rounded-lg border border-gray-100 bg-gray-50/70 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">{entry.label}</p>
              <span
                className={
                  entry.status === "ready"
                    ? "rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                    : entry.status === "missing_recommended"
                      ? "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                      : "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
                }
              >
                {entry.status === "ready"
                  ? "Ready"
                  : entry.status === "missing_recommended"
                    ? "Improve"
                    : "Needs"}
              </span>
            </div>
            {entry.advisoryOnly && (
              <p className="mt-1 text-xs text-gray-500">
                Advisory only; MLS decisions stay outside this checklist.
              </p>
            )}
            {entry.missingRequired.length > 0 && (
              <p className="mt-2 text-xs leading-relaxed text-red-700">
                Needs: {entry.missingRequired.join(", ")}
              </p>
            )}
            {entry.missingRequired.length === 0 &&
              entry.missingRecommended.length > 0 && (
                <p className="mt-2 text-xs leading-relaxed text-amber-700">
                  Improves reach: {entry.missingRecommended.join(", ")}
                </p>
              )}
          </div>
        ))}
      </div>
    </aside>
  );
}

function ToggleChip({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={
        active
          ? "inline-flex items-center rounded-full border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand"
          : "inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      }
    >
      {children}
    </span>
  );
}

export function AddPropertyV2Form({
  availabilityWindowCount,
  replyToEmail,
  contactPhone,
  aiImageImportEnabled,
}: {
  availabilityWindowCount: number;
  replyToEmail: string | null;
  contactPhone: string | null;
  aiImageImportEnabled: boolean;
}) {
  const [mode, setMode] = useState<"import" | "fresh">("import");
  const [draft, setDraft] = useState<AddPropertyV2Draft>(
    EMPTY_ADD_PROPERTY_V2_DRAFT,
  );
  const [listingText, setListingText] = useState("");
  const [photoCount, setPhotoCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const [descriptionMessage, setDescriptionMessage] = useState<string | null>(
    null,
  );
  const [isImportPending, startImportTransition] = useTransition();
  const [isDescriptionPending, startDescriptionTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const readiness = useMemo(
    () =>
      buildChannelReadiness(
        buildAddPropertyV2ReadinessInput(draft, {
          photoCount,
          availabilityWindowCount,
          replyToEmail,
          contactPhone,
        }),
      ),
    [availabilityWindowCount, contactPhone, draft, photoCount, replyToEmail],
  );

  function update<K extends keyof AddPropertyV2Draft>(
    key: K,
    value: AddPropertyV2Draft[K],
  ) {
    setDraft((current) => setValue(current, key, value));
  }

  function applyPrefill(formData: FormData) {
    setImportMessage(null);
    startImportTransition(async () => {
      const result = await prefillAddPropertyV2(formData);
      if (!result.ok) {
        setImportMessage(result.message);
        return;
      }
      setDraft((current) => ({
        ...current,
        ...result.draft,
        amenities: result.draft.amenities,
      }));
      setMode("fresh");
      setImportMessage(
        `Prefilled ${result.filledFields.length} fields from ${
          result.source === "images" ? "images" : "the listing"
        }.`,
      );
    });
  }

  async function readPdf(file: File) {
    const looksPdf =
      file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!looksPdf) {
      setPdfMessage("Choose a PDF data sheet, or paste the listing text.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setPdfMessage("That PDF is too large. Paste the listing text instead.");
      return;
    }

    setPdfMessage(`Reading ${file.name}...`);
    try {
      const pdfjs = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({ data }).promise;
      const pageCount = Math.min(doc.numPages, MAX_PAGES);
      const pages: PdfTextItemLike[][] = [];
      const linkUrls: string[] = [];
      for (let p = 1; p <= pageCount; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        pages.push(
          (content.items as Array<Partial<PdfTextItemLike>>).filter(
            (it): it is PdfTextItemLike => typeof it.str === "string",
          ),
        );
        try {
          const annots = (await page.getAnnotations()) as Array<{
            subtype?: string;
            url?: string;
          }>;
          for (const a of annots) {
            if (a.subtype === "Link" && typeof a.url === "string" && a.url) {
              linkUrls.push(a.url);
            }
          }
        } catch {
          /* no annotations */
        }
      }
      const assembled = [
        assembleDocumentText(pages),
        ...Array.from(new Set(linkUrls)),
      ]
        .filter((s) => s.trim().length > 0)
        .join("\n");
      if (!assembled.trim()) {
        setPdfMessage("Couldn't read text from that PDF.");
        return;
      }
      setListingText(assembled);
      setPdfMessage(`Read ${file.name}.`);
    } catch {
      setPdfMessage("Couldn't read that PDF. Paste the listing text instead.");
    }
  }

  function prefillFromText() {
    const fd = new FormData();
    fd.set("listing_text", listingText);
    applyPrefill(fd);
  }

  function prefillFromImages() {
    const fd = new FormData();
    for (const file of Array.from(imageInputRef.current?.files ?? [])) {
      fd.append("listing_images", file);
    }
    applyPrefill(fd);
  }

  function draftDescription() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    setDescriptionMessage(null);
    startDescriptionTransition(async () => {
      const result = await draftAddPropertyV2Description(fd);
      if (!result.ok) {
        setDescriptionMessage(result.message);
        return;
      }
      update("description", result.description);
      setDescriptionMessage(
        result.source === "ai"
          ? "AI draft added. Review before saving."
          : "Draft added from the structured fields.",
      );
    });
  }

  function imageInputChanged(files: FileList | null) {
    if (!files || files.length === 0) {
      setImageCount(0);
      return;
    }
    const good = Array.from(files).filter(
      (f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type) && f.size <= MAX_IMAGE_BYTES,
    );
    setImageCount(Math.min(good.length, MAX_IMAGE_FILES));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form
        ref={formRef}
        action={createPropertyV2}
        encType="multipart/form-data"
        className="space-y-5"
      >
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("import")}
              className={
                mode === "import"
                  ? "rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white"
                  : SECONDARY_ACTION_CLASS
              }
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => setMode("fresh")}
              className={
                mode === "fresh"
                  ? "rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white"
                  : SECONDARY_ACTION_CLASS
              }
            >
              Start fresh
            </button>
          </div>

          {mode === "import" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void readPdf(file);
                }}
                onClick={() => pdfInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pdfInputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={0}
                className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 px-4 py-5 text-center hover:bg-gray-50"
              >
                <p className="text-sm font-medium text-gray-700">
                  Drop a data-sheet PDF, or click to choose
                </p>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void readPdf(file);
                    e.target.value = "";
                  }}
                />
              </div>
              {pdfMessage && (
                <p className="text-xs font-medium text-gray-600">{pdfMessage}</p>
              )}
              <Field label="Paste listing text" htmlFor="listing_text_v2">
                <textarea
                  id="listing_text_v2"
                  rows={7}
                  value={listingText}
                  onChange={(e) => setListingText(e.target.value)}
                  placeholder="Paste a realtor.ca, MLS, Kijiji, Facebook Marketplace, or property-manager listing..."
                  className={inputClass()}
                />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={prefillFromText}
                  disabled={isImportPending || listingText.trim().length === 0}
                  className={`${SECONDARY_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {isImportPending ? "Prefilling..." : "Prefill from listing"}
                </button>
                {aiImageImportEnabled && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      multiple
                      onChange={(e) => imageInputChanged(e.target.files)}
                      className="block max-w-56 text-xs text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-200"
                    />
                    <button
                      type="button"
                      onClick={prefillFromImages}
                      disabled={isImportPending || imageCount === 0}
                      className={`${SECONDARY_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {isImportPending ? "Reading..." : "Prefill from images"}
                    </button>
                  </div>
                )}
              </div>
              {importMessage && (
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
                  {importMessage}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Core</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
            <div className="sm:col-span-6">
              <Field label="Address" htmlFor="address">
                <input
                  id="address"
                  name="address"
                  required
                  value={draft.address}
                  onChange={(e) => update("address", e.target.value)}
                  className={inputClass()}
                />
              </Field>
            </div>
            <Field label="Rent ($/mo)" htmlFor="rent">
              <input
                id="rent"
                name="rent"
                type="number"
                step="0.01"
                value={draft.rent}
                onChange={(e) => update("rent", e.target.value)}
                className={inputClass()}
              />
            </Field>
            <Field label="Beds" htmlFor="beds">
              <input
                id="beds"
                name="beds"
                type="number"
                step="1"
                value={draft.beds}
                onChange={(e) => update("beds", e.target.value)}
                className={inputClass()}
              />
            </Field>
            <Field label="Baths" htmlFor="baths">
              <input
                id="baths"
                name="baths"
                type="number"
                step="0.5"
                value={draft.baths}
                onChange={(e) => update("baths", e.target.value)}
                className={inputClass()}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Available date" htmlFor="available_date">
                <input
                  id="available_date"
                  name="available_date"
                  type="date"
                  value={draft.available_date}
                  onChange={(e) => update("available_date", e.target.value)}
                  className={inputClass()}
                />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Unit type" htmlFor="unit_type">
                <select
                  id="unit_type"
                  name="unit_type"
                  value={draft.unit_type}
                  onChange={(e) => update("unit_type", e.target.value)}
                  className={selectClass()}
                >
                  <option value="">Not specified</option>
                  {UNIT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {unitTypeLabel(opt)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Structure" htmlFor="structure_type">
                <select
                  id="structure_type"
                  name="structure_type"
                  value={draft.structure_type}
                  onChange={(e) => update("structure_type", e.target.value)}
                  className={selectClass()}
                >
                  <option value="">Unknown</option>
                  {STRUCTURE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {structureTypeLabel(opt)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Public address display" htmlFor="address_display_mode">
                <select
                  id="address_display_mode"
                  name="address_display_mode"
                  value={draft.address_display_mode}
                  onChange={(e) => update("address_display_mode", e.target.value)}
                  className={selectClass()}
                >
                  <option value="full">Full address</option>
                  <option value="hide_unit">Hide unit number</option>
                  <option value="approximate">Approximate</option>
                </select>
              </Field>
            </div>
          </div>
        </section>

        <details open className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">
            Size, layout, and amenities
          </summary>
          <div className="mt-4 space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <Field label="Size (sq ft)" htmlFor="sqft">
                <input
                  id="sqft"
                  name="sqft"
                  type="number"
                  step="1"
                  value={draft.sqft}
                  onChange={(e) => update("sqft", e.target.value)}
                  className={inputClass()}
                />
              </Field>
              <Field label="Floor" htmlFor="floor">
                <input
                  id="floor"
                  name="floor"
                  value={draft.floor}
                  onChange={(e) => update("floor", e.target.value)}
                  className={inputClass()}
                />
              </Field>
              <Field label="Lease term" htmlFor="lease_term">
                <select
                  id="lease_term"
                  name="lease_term"
                  value={draft.lease_term}
                  onChange={(e) => update("lease_term", e.target.value)}
                  className={selectClass()}
                >
                  <option value="">Not specified</option>
                  {LEASE_TERM_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {leaseTermLabel(opt)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Heating" htmlFor="heating_type">
                <select
                  id="heating_type"
                  name="heating_type"
                  value={draft.heating_type}
                  onChange={(e) => update("heating_type", e.target.value)}
                  className={selectClass()}
                >
                  <option value="">Not specified</option>
                  {HEATING_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {HEATING_TYPE_LABELS[opt]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              {AMENITY_KEYS.map((key) => {
                const active = draft.amenities.includes(key);
                return (
                  <label key={key} className="cursor-pointer">
                    <input
                      type="checkbox"
                      name="amenities"
                      value={key}
                      checked={active}
                      onChange={(e) => {
                        update(
                          "amenities",
                          e.target.checked
                            ? [...draft.amenities, key]
                            : draft.amenities.filter((value) => value !== key),
                        );
                      }}
                      className="sr-only"
                    />
                    <ToggleChip active={active}>{AMENITY_LABELS[key]}</ToggleChip>
                  </label>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Laundry" htmlFor="laundry">
                <select
                  id="laundry"
                  name="laundry"
                  value={draft.laundry}
                  onChange={(e) => update("laundry", e.target.value)}
                  className={selectClass()}
                >
                  <option value="">Not specified</option>
                  {LAUNDRY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {laundryLabel(opt)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="A/C type" htmlFor="ac_type">
                <select
                  id="ac_type"
                  name="ac_type"
                  value={draft.ac_type}
                  onChange={(e) => update("ac_type", e.target.value)}
                  className={selectClass()}
                >
                  <option value="">Not specified</option>
                  {AC_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === "none" ? "No A/C" : `A/C: ${acTypeLabel(opt)}`}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end gap-4">
                {(
                  [
                    ["furnished", "Furnished"],
                    ["air_conditioning", "A/C"],
                    ["balcony", "Balcony"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      name={key}
                      checked={Boolean(draft[key])}
                      onChange={(e) => update(key, e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </details>

        <details className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">
            Parking and utilities
          </summary>
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap gap-2">
              {PARKING_TYPE_OPTIONS.map((opt) => {
                const active = draft.parking_type === opt;
                return (
                  <label key={opt} className="cursor-pointer">
                    <input
                      type="radio"
                      name="parking_type"
                      value={opt}
                      checked={active}
                      onChange={() => update("parking_type", opt)}
                      className="sr-only"
                    />
                    <ToggleChip active={active}>{PARKING_TYPE_LABELS[opt]}</ToggleChip>
                  </label>
                );
              })}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Parking count" htmlFor="parking_count">
                <input
                  id="parking_count"
                  name="parking_count"
                  type="number"
                  step="1"
                  value={draft.parking_count}
                  onChange={(e) => update("parking_count", e.target.value)}
                  className={inputClass()}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Parking notes" htmlFor="parking">
                  <input
                    id="parking"
                    name="parking"
                    value={draft.parking}
                    onChange={(e) => update("parking", e.target.value)}
                    className={inputClass()}
                  />
                </Field>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
              {(
                [
                  ["heat_included", "Heat"],
                  ["hydro_included", "Hydro"],
                  ["water_included", "Water"],
                  ["internet_included", "Internet"],
                  ["cable_included", "Cable"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label} htmlFor={key}>
                  <select
                    id={key}
                    name={key}
                    value={draft[key]}
                    onChange={(e) => update(key, e.target.value)}
                    className={selectClass()}
                  >
                    <option value="">Unknown</option>
                    <option value="true">Included</option>
                    <option value="false">Tenant pays</option>
                  </select>
                </Field>
              ))}
            </div>
          </div>
        </details>

        <details className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">
            Pets, smoking, money, and media
          </summary>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-6">
            {(
              [
                ["pets_cats", "Cats"],
                ["pets_dogs", "Dogs"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="sm:col-span-2">
                <Field label={label} htmlFor={key}>
                  <select
                    id={key}
                    name={key}
                    value={draft[key]}
                    onChange={(e) => update(key, e.target.value)}
                    className={selectClass()}
                  >
                    <option value="">Unknown</option>
                    <option value="true">Welcome</option>
                    <option value="false">Not welcome</option>
                  </select>
                </Field>
              </div>
            ))}
            <div className="sm:col-span-2">
              <Field label="Dog size" htmlFor="pets_dog_size">
                <select
                  id="pets_dog_size"
                  name="pets_dog_size"
                  value={draft.pets_dog_size}
                  onChange={(e) => update("pets_dog_size", e.target.value)}
                  className={selectClass()}
                >
                  <option value="">No limit set</option>
                  {DOG_SIZE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {dogSizeLabel(opt)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Pet notes" htmlFor="pets_notes">
                <input
                  id="pets_notes"
                  name="pets_notes"
                  value={draft.pets_notes}
                  onChange={(e) => update("pets_notes", e.target.value)}
                  className={inputClass()}
                />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Smoking" htmlFor="smoking">
                <select
                  id="smoking"
                  name="smoking"
                  value={draft.smoking}
                  onChange={(e) => update("smoking", e.target.value)}
                  className={selectClass()}
                >
                  <option value="">Not specified</option>
                  {SMOKING_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {smokingLabel(opt)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Security deposit ($)" htmlFor="security_deposit">
                <input
                  id="security_deposit"
                  name="security_deposit"
                  type="number"
                  step="0.01"
                  value={draft.security_deposit}
                  onChange={(e) => update("security_deposit", e.target.value)}
                  className={inputClass()}
                />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Income requirement" htmlFor="income_requirement">
                <input
                  id="income_requirement"
                  name="income_requirement"
                  value={draft.income_requirement}
                  onChange={(e) => update("income_requirement", e.target.value)}
                  className={inputClass()}
                />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Virtual tour URL" htmlFor="virtual_tour_url">
                <input
                  id="virtual_tour_url"
                  name="virtual_tour_url"
                  type="url"
                  value={draft.virtual_tour_url}
                  onChange={(e) => update("virtual_tour_url", e.target.value)}
                  className={inputClass()}
                />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Video URL" htmlFor="video_url">
                <input
                  id="video_url"
                  name="video_url"
                  type="url"
                  value={draft.video_url}
                  onChange={(e) => update("video_url", e.target.value)}
                  className={inputClass()}
                />
              </Field>
            </div>
            <div className="sm:col-span-6">
              <Field label="Photos" htmlFor="photos">
                <input
                  id="photos"
                  name="photos"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
                />
              </Field>
            </div>
          </div>
        </details>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900">Description</h2>
            <button
              type="button"
              onClick={draftDescription}
              disabled={isDescriptionPending}
              className={`${SECONDARY_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {isDescriptionPending ? "Drafting..." : "AI draft"}
            </button>
          </div>
          <textarea
            name="description"
            rows={8}
            value={draft.description}
            onChange={(e) => update("description", e.target.value)}
            className={inputClass()}
          />
          {descriptionMessage && (
            <p className="mt-2 text-xs font-medium text-gray-600">
              {descriptionMessage}
            </p>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingLabel="Saving..."
            className={PRIMARY_ACTION_CLASS}
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Save draft
          </SubmitButton>
          <span className="text-xs text-gray-500">
            Lands on the rental detail page after save.
          </span>
        </div>
      </form>

      <ReadinessMeter entries={readiness} />
    </div>
  );
}
