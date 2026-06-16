import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { submitFeedback } from "./actions";
import { StarRating } from "./star-rating";
import { accessibleBrand } from "@/lib/brand-theme";

export const dynamic = "force-dynamic";

type Context = {
  showing_id: string;
  org_name: string;
  brand_color: string | null;
  logo_url: string | null;
  property_address: string | null;
  renter_name: string | null;
  already_submitted: boolean;
};

function firstName(name: string | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] || "there";
}

export default async function PublicFeedbackPage({
  params,
  searchParams,
}: {
  params: { showingId: string };
  searchParams: { submitted?: string; error?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_public_feedback_context", {
    p_showing_id: params.showingId,
  });

  if (!data) notFound();
  const c = data as Context;
  // Guardrail: legible header/button white text + visible stars on a pale brand.
  const brand = accessibleBrand(c.brand_color || "#4f46e5");

  const done = c.already_submitted || searchParams.submitted === "1";
  const addr = c.property_address || "your showing";

  return (
    <div className="min-h-screen bg-gray-50" style={{ ["--brand-color" as string]: brand }}>
      <header className="text-white" style={{ backgroundColor: brand }}>
        <div className="mx-auto max-w-md px-6 py-5">
          {c.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.logo_url} alt={c.org_name} className="h-8" />
          ) : (
            <p className="text-lg font-bold">{c.org_name}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-md px-6 py-10">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {done ? (
            <div className="text-center">
              <h1 className="text-xl font-bold text-gray-900">Thanks for your feedback!</h1>
              <p className="mt-2 text-sm text-gray-600">
                We appreciate you letting {c.org_name} know how it went.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-gray-900">
                How was your showing?
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                Hi {firstName(c.renter_name)}, thanks for visiting{" "}
                <span className="font-medium text-gray-800">{addr}</span>. Your
                feedback helps {c.org_name} improve.
              </p>

              {searchParams.error === "rating" && (
                <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Please pick a star rating before submitting.
                </p>
              )}
              {searchParams.error === "1" && (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  We couldn't record that. Your feedback may already be in.
                  Thanks all the same!
                </p>
              )}

              <form action={submitFeedback} className="mt-6 space-y-5">
                <input type="hidden" name="showing_id" value={c.showing_id} />

                <StarRating brand={brand} />

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Anything you'd like to add?{" "}
                    <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    name="comments"
                    rows={4}
                    placeholder="What stood out, good or bad?"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-lg px-4 py-2.5 font-medium text-white"
                  style={{ backgroundColor: brand }}
                >
                  Submit feedback
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">Powered by Vacantless</p>
      </main>
    </div>
  );
}
