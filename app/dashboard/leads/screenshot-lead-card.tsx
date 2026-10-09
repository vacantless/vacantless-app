"use client";

// S702: add a renter from a chat screenshot (Facebook, Kijiji, WhatsApp, a
// text). The AI fills the form. The landlord checks it and saves.
import { useState, useTransition } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import {
  addRenterFromScreenshot,
  readScreenshot,
  type ScreenshotDraft,
} from "./screenshot-actions";

export type ScreenshotRental = { id: string; address: string };

export function ScreenshotLeadCard({
  rentals,
  notice,
}: {
  rentals: ScreenshotRental[];
  notice: string | null;
}) {
  const [draft, setDraft] = useState<ScreenshotDraft | null>(null);
  const [error, setError] = useState<string | null>(notice);
  const [pending, startTransition] = useTransition();

  function onRead(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await readScreenshot(formData);
      if (result.ok) setDraft(result.draft);
      else setError(result.error);
    });
  }

  return (
    <Card className="mb-5">
      <details open={Boolean(notice) || undefined}>
        <summary className="cursor-pointer text-base font-bold text-[var(--vl-text-primary)]">
          Add a renter from a screenshot
        </summary>
        <p className="mt-2 text-base text-[var(--vl-text-secondary)]">
          Chatting with a renter on Facebook, Kijiji or by text? Upload a screenshot of the chat. We fill in their details for you.
        </p>

        {!draft && (
          <form action={onRead} className="mt-4 flex flex-wrap items-center gap-3">
            <input
              type="file"
              name="screenshot"
              accept="image/png,image/jpeg,image/webp,image/gif"
              required
              className="text-sm"
            />
            <Button type="submit" disabled={pending}>
              {pending ? "Reading..." : "Read the screenshot"}
            </Button>
          </form>
        )}

        {error && (
          <p className="mt-3 text-sm font-medium text-red-700" role="alert">
            {error}
          </p>
        )}

        {draft && (
          <form action={addRenterFromScreenshot} className="mt-4 grid gap-3 sm:grid-cols-2">
            <p className="text-sm text-[var(--vl-text-secondary)] sm:col-span-2">
              Check these details. Fix anything we got wrong.
            </p>
            <Field label="Name" htmlFor="ss-name">
              <Input id="ss-name" name="name" defaultValue={draft.name} />
            </Field>
            <Field label="Phone" htmlFor="ss-phone">
              <Input id="ss-phone" name="phone" defaultValue={draft.phone} />
            </Field>
            <Field label="Email" htmlFor="ss-email">
              <Input id="ss-email" name="email" type="email" defaultValue={draft.email} />
            </Field>
            <Field label="Where you are chatting" htmlFor="ss-site">
              <Input id="ss-site" name="site" defaultValue={draft.site} />
            </Field>
            <Field label="Rental" htmlFor="ss-rental">
              <Select id="ss-rental" name="property_id" defaultValue={draft.propertyId}>
                <option value="">Not sure yet</option>
                {rentals.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.address}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="What they asked" htmlFor="ss-question">
              <Input id="ss-question" name="question" defaultValue={draft.question} />
            </Field>
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <Button type="submit">Add this renter</Button>
              <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
                Try another picture
              </Button>
            </div>
            <p className="text-sm text-[var(--vl-text-muted)] sm:col-span-2">
              A phone or an email is needed. We do not message the renter. Keep chatting where you are.
            </p>
          </form>
        )}
      </details>
    </Card>
  );
}
