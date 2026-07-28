import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuidLike } from "@/lib/rent-confirm-public";
import { leaseTermShiftEnabled } from "@/lib/rent-adjustments-server";
import { confirmRentFromToken } from "./actions";

export const dynamic = "force-dynamic";

type RentConfirmContext = {
  ok?: boolean;
  reason?: string;
  tenancy_id?: string;
  unit_address?: string | null;
  current_rent_cents?: number | null;
  current_effective_date?: string | null;
  primary_tenant_name?: string | null;
  already_confirmed?: boolean;
  has_baseline?: boolean;
};

function asContext(value: unknown): RentConfirmContext | null {
  if (!value || typeof value !== "object") return null;
  return value as RentConfirmContext;
}

function formatRent(cents: number | null | undefined): string {
  if (cents == null) return "Rent on file";
  return `$${(cents / 100).toLocaleString("en-CA", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}/month`;
}

function dollarsValue(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toString();
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="min-h-screen px-4 py-8 text-[#17362f] sm:px-6"
      style={{ backgroundColor: "#17362f" }}
    >
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center">
        <div className="w-full rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-wide text-[#55746b]">
              Vacantless
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-[#17362f]">
              Confirm your rent
            </h1>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

function Message({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body: string;
  tone?: "neutral" | "success" | "error";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "error"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-gray-200 bg-gray-50 text-gray-700";
  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm">{body}</p>
    </div>
  );
}

export default async function ConfirmRentPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  if (!leaseTermShiftEnabled()) notFound();

  const token = params.token.trim();
  if (!isUuidLike(token)) {
    return (
      <Shell>
        <Message
          title="This link is not active."
          body="Ask your Vacantless contact for a fresh rent confirmation link."
          tone="error"
        />
      </Shell>
    );
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_rent_confirm_context", {
    p_token: token,
  });
  const context = asContext(data);
  if (error || !context || context.ok === false) {
    return (
      <Shell>
        <Message
          title="This link is not active."
          body="It may have expired, or it may not match an active tenancy."
          tone="error"
        />
      </Shell>
    );
  }

  const done = searchParams.status === "done";
  const invalid = searchParams.status === "invalid";
  const errored = searchParams.status === "error";
  const alreadyConfirmed = context.already_confirmed === true;
  const hasBaseline =
    typeof context.has_baseline === "boolean"
      ? context.has_baseline
      : context.current_rent_cents != null && context.current_rent_cents > 0;
  const unit = context.unit_address?.trim() || "Your unit";
  const tenantName = context.primary_tenant_name?.trim();
  const currentRent = hasBaseline
    ? formatRent(context.current_rent_cents)
    : "No rent on file yet";

  return (
    <Shell>
      <div className="space-y-5">
        {done && (
          <Message
            title="Thank you. Rent is confirmed."
            body="Vacantless saved this to the rent record for this unit."
            tone="success"
          />
        )}
        {invalid && (
          <Message
            title="Check the rent details."
            body="The rent amount or effective date was missing. Nothing was saved."
            tone="error"
          />
        )}
        {errored && (
          <Message
            title="We could not save that yet."
            body="Please try again, or ask your Vacantless contact to help."
            tone="error"
          />
        )}

        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Property
          </p>
          <h2 className="mt-1 text-xl font-semibold text-gray-950">{unit}</h2>
          {tenantName && (
            <p className="mt-1 text-sm text-gray-600">Tenant: {tenantName}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm font-medium text-gray-700">
              {currentRent}
            </span>
            {context.current_effective_date && (
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm font-medium text-gray-700">
                Since {context.current_effective_date}
              </span>
            )}
          </div>
        </section>

        {alreadyConfirmed ? (
          <Message
            title="Already confirmed."
            body="This unit already has a landlord-confirmed rent record."
            tone="success"
          />
        ) : (
          <section className="space-y-3">
            {hasBaseline ? (
              <>
                <p className="text-sm text-gray-600">
                  Please confirm the rent the tenant pays today. This keeps the
                  rent-increase math from using an old lease amount.
                </p>

                <form action={confirmRentFromToken}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="status" value="unchanged" />
                  <button
                    type="submit"
                    className="w-full rounded-2xl px-4 py-4 text-base font-semibold text-white shadow-sm transition hover:opacity-95"
                    style={{ backgroundColor: "#17362f" }}
                  >
                    Still the same
                  </button>
                </form>

                <details className="group rounded-2xl border border-gray-200 bg-white">
                  <summary className="cursor-pointer list-none rounded-2xl px-4 py-4 text-center text-base font-semibold text-[#17362f] outline-none transition hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                    It changed
                  </summary>
                  <form action={confirmRentFromToken} className="space-y-4 border-t border-gray-100 p-4">
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="status" value="changed" />
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Current monthly rent ($)
                      </label>
                      <input
                        type="number"
                        name="current_rent"
                        step="0.01"
                        min="0"
                        required
                        defaultValue={dollarsValue(context.current_rent_cents)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-base"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Date this rent started
                      </label>
                      <input
                        type="date"
                        name="current_rent_effective_date"
                        required
                        defaultValue={context.current_effective_date ?? ""}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-base"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full rounded-2xl px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:opacity-95"
                      style={{ backgroundColor: "#17362f" }}
                    >
                      Confirm updated rent
                    </button>
                  </form>
                </details>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  We do not have a rent on file for this unit yet. Enter the
                  current rent so Vacantless can track your rent increase
                  timing.
                </p>

                <form
                  action={confirmRentFromToken}
                  className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4"
                >
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="status" value="set" />
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Current monthly rent ($)
                    </label>
                    <input
                      type="number"
                      name="current_rent"
                      step="0.01"
                      min="0.01"
                      required
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-base"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Date this rent started
                    </label>
                    <input
                      type="date"
                      name="current_rent_effective_date"
                      required
                      defaultValue={context.current_effective_date ?? ""}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-base"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-2xl px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:opacity-95"
                    style={{ backgroundColor: "#17362f" }}
                  >
                    Confirm your rent
                  </button>
                </form>
              </>
            )}
          </section>
        )}
      </div>
    </Shell>
  );
}
