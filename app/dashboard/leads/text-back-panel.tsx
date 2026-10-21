import { textRenter } from "./actions";

// S728: one box to text the renter from the account's own number. Rendered
// only when the account really texts, the renter left a number and has not
// texted STOP (the page decides; this just draws the form).
export function TextBackPanel({
  leadId,
  phoneLabel,
  flash,
}: {
  leadId: string;
  phoneLabel: string;
  flash: string | null;
}) {
  const note =
    flash === "sent"
      ? { tone: "ok", text: "Text sent. Their reply lands on this page and in your email." }
      : flash === "failed"
        ? { tone: "bad", text: "The text did not go out. Try again in a minute, or call them." }
        : flash === "empty"
          ? { tone: "bad", text: "Write the text first." }
          : flash === "opted_out"
            ? { tone: "bad", text: "This renter texted STOP, so no texts go to them." }
            : flash === "not_on"
              ? { tone: "bad", text: "Texting is not on for your account yet." }
              : null;
  return (
    <form
      id="text-back"
      action={textRenter}
      className="mt-4 scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <input type="hidden" name="id" value={leadId} />
      <h3 className="text-sm font-semibold text-gray-900">Text this renter</h3>
      <p className="mt-1 text-xs text-gray-500">
        Goes to {phoneLabel} from your texting number, so they see the same number they texted. Up to 320 characters.
      </p>
      {note && (
        <p
          className={`mt-2 rounded-lg px-3 py-2 text-xs ${
            note.tone === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
          }`}
        >
          {note.text}
        </p>
      )}
      <textarea
        name="text"
        rows={3}
        maxLength={320}
        required
        className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        placeholder="Hi, this is the leasing team. Does Wednesday at 5 pm still work for the viewing?"
      />
      <div className="mt-3">
        <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
          Send text
        </button>
      </div>
    </form>
  );
}
