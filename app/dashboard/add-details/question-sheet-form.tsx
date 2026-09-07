"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, Card, Field, Input, Select, StatusBanner } from "@/components/ui";
import type {
  QuestionKey,
  QuestionSheet,
  SheetQuestion,
} from "@/lib/question-sheet";
import {
  saveQuestionSheet,
  type SaveQuestionSheetResult,
} from "@/app/dashboard/properties/actions";

// The Post Everywhere question sheet (SPEC-S688 Slice 2 sections 4.2 + 5,
// S692). One form, one submit. Renders ONLY the questions the record does not
// hold, grouped: must answer / answer once / recommended / your contact
// details. Every control is uncontrolled and prefilled from `current`; a blank
// control means "skip" (the action never clears a value). After a save the
// server re-renders the sheet, so answered questions disappear and the counts
// in the header come from the rebuilt sheet, not from this component.

export type QuestionSheetCopy = {
  title: string;
  sub: string;
  requiredTitle: string;
  requiredSub: string;
  answerOnceTitle: string;
  answerOnceSub: string;
  recommendedTitle: string;
  recommendedSub: string;
  orgTitle: string;
  orgSub: string;
  orgReadOnly: string;
  choose: string;
  yes: string;
  no: string;
  cats: string;
  dogs: string;
  dogSize: string;
  petsNotes: string;
  parkingType: string;
  parkingCount: string;
  addPhotos: string;
  save: string;
  saving: string;
  saved: string;
  savedComplete: string;
  skippedOrg: string; // "{fields}" placeholder
  fixErrors: string;
  mirrored: string;
  neededBy: string; // "{sites}" placeholder
  wouldPost: string; // "{value}" placeholder
  photosLine: string; // "{current}" + "{min}"
  labels: Record<QuestionKey, string>;
  siteLabels: Record<string, string>;
};

type FieldErrors = Partial<Record<QuestionKey, string>>;

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

function centsToDollars(cents: unknown): string {
  return typeof cents === "number" && Number.isFinite(cents) && cents > 0
    ? (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
    : "";
}

function triValue(v: unknown): string {
  return v === true ? "true" : v === false ? "false" : "";
}

export function QuestionSheetForm({
  propertyId,
  propertyPageHref,
  sheet,
  copy,
  todayIso,
}: {
  propertyId: string;
  propertyPageHref: string;
  sheet: QuestionSheet;
  copy: QuestionSheetCopy;
  /** Computed once on the server so the date input's min never hydrates differently (reviewer P3). */
  todayIso: string;
}) {
  const router = useRouter();
  // A plain flag, not useTransition: on React 18 a transition does not wait
  // for an async callback, so "Saving..." would clear before the action
  // resolved and a second click could double-submit (reviewer P2).
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<{ tone: "success" | "attention"; text: string } | null>(null);

  const required = sheet.questions.filter((q) => q.tier === "required" && q.scope === "property");
  const answerOnce = sheet.questions.filter((q) => q.tier === "answer_once" && q.scope === "property");
  const recommended = sheet.questions.filter((q) => q.tier === "recommended" && q.scope === "property");
  const orgQuestions = sheet.questions.filter((q) => q.scope === "organization");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const formData = new FormData(event.currentTarget);
    for (const channel of sheet.channels) formData.append("channels", channel);
    setNotice(null);
    inFlight.current = true;
    setPending(true);
    try {
      let result: SaveQuestionSheetResult;
      try {
        result = await saveQuestionSheet(propertyId, formData);
      } catch (e) {
        setNotice({ tone: "attention", text: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (!result.ok) {
        setNotice({ tone: "attention", text: result.message });
        return;
      }
      const nextErrors: FieldErrors = {};
      for (const err of result.errors) nextErrors[err.key] = err.message;
      setErrors(nextErrors);
      const parts: string[] = [];
      if (result.errors.length > 0) parts.push(copy.fixErrors);
      else parts.push(result.complete ? copy.savedComplete : copy.saved);
      if (result.skippedOrgFields.length > 0) {
        parts.push(
          fill(copy.skippedOrg, {
            fields: result.skippedOrgFields.map((k) => copy.labels[k] ?? k).join(", "),
          }),
        );
      }
      if (result.stamped && result.mirroredFields.some((f) => f !== "for_rent_by")) {
        parts.push(copy.mirrored);
      }
      setNotice({
        tone: result.errors.length > 0 ? "attention" : "success",
        text: parts.join(" "),
      });
      router.refresh();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const label = (q: SheetQuestion) => copy.labels[q.key] ?? q.label;
  const neededBy = (q: SheetQuestion) =>
    q.neededBy.length > 0
      ? fill(copy.neededBy, {
          sites: q.neededBy.map((c) => copy.siteLabels[c] ?? c).join(", "),
        })
      : null;

  function control(q: SheetQuestion) {
    const id = `qs-${q.key}`;
    const invalid = Boolean(errors[q.key]);
    const disabled = q.readOnly;
    switch (q.input.kind) {
      case "money":
        return (
          <Input
            id={id}
            name="rent"
            inputMode="decimal"
            placeholder="1,250"
            defaultValue={centsToDollars(q.current)}
            invalid={invalid}
          />
        );
      case "integer":
        return (
          <Input
            id={id}
            name={q.key}
            type="number"
            min={q.input.min}
            max={q.input.max}
            step={1}
            defaultValue={typeof q.current === "number" ? String(q.current) : ""}
            invalid={invalid}
          />
        );
      case "decimal_half":
        return (
          <Input
            id={id}
            name={q.key}
            type="number"
            min={0}
            max={20}
            step={0.5}
            defaultValue={typeof q.current === "number" ? String(q.current) : ""}
            invalid={invalid}
          />
        );
      case "date":
        return (
          <Input
            id={id}
            name={q.key}
            type="date"
            min={q.input.minToday ? todayIso : undefined}
            defaultValue={typeof q.current === "string" ? q.current : ""}
            invalid={invalid}
          />
        );
      case "text":
        return (
          <Input
            id={id}
            name={q.key}
            maxLength={q.input.maxLength}
            defaultValue={typeof q.current === "string" ? q.current : ""}
            invalid={invalid}
          />
        );
      case "textarea":
        return (
          <textarea
            id={id}
            name={q.key}
            rows={5}
            minLength={q.input.minLength}
            defaultValue={typeof q.current === "string" ? q.current : ""}
            aria-invalid={invalid || undefined}
            className="w-full rounded-[var(--vl-radius-md)] border border-[var(--vl-border)] bg-[var(--vl-surface-elevated)] px-3 py-2 text-[length:var(--vl-type-workbench-body)] text-[var(--vl-text-primary)] shadow-sm focus:border-[var(--vl-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--vl-focus-ring)]"
          />
        );
      case "select":
        return (
          <Select
            id={id}
            name={q.key}
            defaultValue={typeof q.current === "string" ? q.current : ""}
            invalid={invalid}
            disabled={disabled}
          >
            <option value="">{copy.choose}</option>
            {q.input.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );
      case "tri_state":
        return (
          <Select id={id} name={q.key} defaultValue={triValue(q.current)} invalid={invalid}>
            <option value="">{copy.choose}</option>
            <option value="true">{copy.yes}</option>
            <option value="false">{copy.no}</option>
          </Select>
        );
      case "multi": {
        // One Yes / No / blank select per utility: blank is "skip", never
        // "not included" (reviewer P1). Heat, hydro, water are the answer;
        // internet and cable are optional extras.
        const cur = (q.current ?? {}) as Record<string, boolean | null | undefined>;
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            {q.input.options.map((o) => (
              <Field key={o.value} label={o.label} htmlFor={`${id}-${o.value}`}>
                <Select
                  id={`${id}-${o.value}`}
                  name={`utilities_${o.value}`}
                  defaultValue={triValue(cur[o.value])}
                  invalid={invalid}
                >
                  <option value="">{copy.choose}</option>
                  <option value="true">{copy.yes}</option>
                  <option value="false">{copy.no}</option>
                </Select>
              </Field>
            ))}
          </div>
        );
      }
      case "pets": {
        const cur = (q.current ?? {}) as { cats?: boolean | null; dogs?: boolean | null; dog_size?: string | null; notes?: string | null };
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={copy.cats} htmlFor={`${id}-cats`}>
              <Select id={`${id}-cats`} name="pets_cats" defaultValue={triValue(cur.cats)} invalid={invalid}>
                <option value="">{copy.choose}</option>
                <option value="true">{copy.yes}</option>
                <option value="false">{copy.no}</option>
              </Select>
            </Field>
            <Field label={copy.dogs} htmlFor={`${id}-dogs`}>
              <Select id={`${id}-dogs`} name="pets_dogs" defaultValue={triValue(cur.dogs)} invalid={invalid}>
                <option value="">{copy.choose}</option>
                <option value="true">{copy.yes}</option>
                <option value="false">{copy.no}</option>
              </Select>
            </Field>
            <Field label={copy.dogSize} htmlFor={`${id}-size`}>
              <Select id={`${id}-size`} name="pets_dog_size" defaultValue={cur.dog_size ?? ""}>
                <option value="">{copy.choose}</option>
                {q.input.dogSizes.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={copy.petsNotes} htmlFor={`${id}-notes`}>
              <Input id={`${id}-notes`} name="pets_notes" defaultValue={cur.notes ?? ""} />
            </Field>
          </div>
        );
      }
      case "parking": {
        const cur = (q.current ?? {}) as { parking_type?: string | null; parking_count?: number | null; inferred?: boolean };
        return (
          <div className="space-y-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy.parkingType} htmlFor={`${id}-type`}>
                <Select id={`${id}-type`} name="parking_type" defaultValue={cur.parking_type ?? ""} invalid={invalid}>
                  <option value="">{copy.choose}</option>
                  {q.input.types.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={copy.parkingCount} htmlFor={`${id}-count`}>
                <Input
                  id={`${id}-count`}
                  name="parking_count"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  defaultValue={typeof cur.parking_count === "number" ? String(cur.parking_count) : ""}
                  invalid={invalid}
                />
              </Field>
            </div>
            {cur.inferred && q.help ? (
              <p className="text-xs text-[var(--vl-text-muted)]">{q.help}</p>
            ) : null}
          </div>
        );
      }
      case "photos":
        return (
          <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--vl-text-secondary)]">
            <span>
              {fill(copy.photosLine, { current: Math.min(q.input.current, q.input.min), min: q.input.min })}
            </span>
            <a
              href={`${propertyPageHref}?back=add-details#property-photos`}
              className="font-semibold text-[var(--vl-accent)] underline-offset-2 hover:underline"
            >
              {copy.addPhotos}
            </a>
          </div>
        );
      case "org_text":
        return (
          <Input
            id={id}
            name={q.key}
            type={q.input.field === "public_contact_email" ? "email" : "tel"}
            defaultValue={typeof q.current === "string" ? q.current : ""}
            invalid={invalid}
            disabled={disabled}
          />
        );
    }
  }

  function row(q: SheetQuestion) {
    const hint = [neededBy(q), q.help && q.input.kind !== "parking" ? q.help : null]
      .filter(Boolean)
      .join(" ");
    return (
      <Field
        key={q.key}
        label={label(q)}
        htmlFor={`qs-${q.key}`}
        hint={
          <span className="space-x-1">
            {hint ? <span>{hint}</span> : null}
            {q.guessedDefault ? (
              <span className="text-[var(--vl-text-muted)]">{fill(copy.wouldPost, { value: q.guessedDefault })}</span>
            ) : null}
            {q.readOnly ? <span>{copy.orgReadOnly}</span> : null}
          </span>
        }
        error={errors[q.key]}
      >
        {control(q)}
      </Field>
    );
  }

  function group(title: string, sub: string, questions: SheetQuestion[]) {
    if (questions.length === 0) return null;
    return (
      <Card className="space-y-4" padded>
        <div>
          <h2 className="text-xl font-bold leading-tight text-[var(--vl-text-primary)]">{title}</h2>
          <p className="text-[length:var(--vl-type-guided-body)] text-[var(--vl-text-secondary)]">{sub}</p>
        </div>
        <div className="space-y-4">{questions.map(row)}</div>
      </Card>
    );
  }

  if (sheet.questions.length === 0) {
    return (
      <div className="space-y-4" data-question-sheet>
        {notice ? <StatusBanner tone={notice.tone} title={notice.text} /> : null}
        <Card padded>
          <p className="text-[length:var(--vl-type-guided-body)] font-semibold text-[var(--vl-text-primary)]">
            {copy.savedComplete}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-question-sheet>
      {notice ? <StatusBanner tone={notice.tone} title={notice.text} /> : null}
      {group(copy.requiredTitle, copy.requiredSub, required)}
      {group(copy.answerOnceTitle, copy.answerOnceSub, answerOnce)}
      {recommended.length > 0 ? (
        <details className="rounded-[var(--vl-radius-lg)] border border-[var(--vl-border)] bg-[var(--vl-surface)] p-4">
          <summary className="cursor-pointer text-lg font-semibold text-[var(--vl-text-primary)]">
            {copy.recommendedTitle}
          </summary>
          <p className="mt-1 text-[length:var(--vl-type-guided-body)] text-[var(--vl-text-secondary)]">
            {copy.recommendedSub}
          </p>
          <div className="mt-4 space-y-4">{recommended.map(row)}</div>
        </details>
      ) : null}
      {group(copy.orgTitle, copy.orgSub, orgQuestions)}
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? copy.saving : copy.save}
        </Button>
      </div>
    </form>
  );
}
