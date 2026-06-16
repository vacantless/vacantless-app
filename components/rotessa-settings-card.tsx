import {
  connectRotessa,
  testRotessaConnection,
  disconnectRotessa,
} from "@/app/dashboard/settings/rotessa-actions";
import {
  environmentLabel,
  type RotessaConnectionStatus,
} from "@/lib/rotessa";
import {
  Card,
  IconTile,
  StatusChip,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
  type ChipTone,
} from "@/components/ui";
import { Icons } from "@/components/icons";

// The Rotessa rent-collection connection panel on Settings (platform pivot step
// 2, S210). Lets a landlord connect their OWN Rotessa account by pasting an API
// key (encrypted at rest), pick sandbox vs live, test the live connection, and
// disconnect. We never display the stored key and never touch bank data.
//
// Server component: status is read on the server; all mutations go through the
// guarded server actions via plain forms (no client JS needed).

export type RotessaAccountView = {
  environment: string;
  connection_status: string;
  last_verified_at: string | null;
  last_error: string | null;
  hasKey: boolean;
};

function statusTone(status: string): ChipTone {
  if (status === "connected") return "success";
  if (status === "error") return "danger";
  return "neutral";
}

function statusLabel(status: string): string {
  if (status === "connected") return "Connected";
  if (status === "error") return "Connection error";
  return "Not connected";
}

export default function RotessaSettingsCard({
  account,
  encConfigured,
}: {
  account: RotessaAccountView | null;
  encConfigured: boolean;
}) {
  const connected = account?.hasKey ?? false;
  const status = (account?.connection_status ?? "not_connected") as RotessaConnectionStatus;

  return (
    <Card className="mt-6">
      <div id="rotessa" className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconTile size="sm">
            <Icons.card className="h-4 w-4" />
          </IconTile>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Rent collection (Rotessa)
          </h3>
        </div>
        {connected && <StatusChip tone={statusTone(status)}>{statusLabel(status)}</StatusChip>}
      </div>

      <p className="text-sm text-gray-600">
        Connect your own Rotessa account to collect rent by pre-authorized debit.
        Vacantless schedules and tracks payments; your tenants authorize their
        bank details directly in Rotessa. We never store bank account numbers or
        hold funds.
      </p>

      {!encConfigured && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Secure key storage isn&apos;t configured on this deployment yet
          (ROTESSA_ENC_KEY). Rent collection can be connected once it&apos;s set.
        </div>
      )}

      {connected ? (
        <div className="mt-4 space-y-4">
          {/* Current connection summary */}
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-gray-500">Environment</dt>
              <dd className="font-medium text-gray-900">
                {environmentLabel(account?.environment)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">API key</dt>
              <dd className="font-medium text-gray-900">•••• on file</dd>
            </div>
            <div>
              <dt className="text-gray-500">Last verified</dt>
              <dd className="font-medium text-gray-900">
                {account?.last_verified_at
                  ? new Date(account.last_verified_at).toLocaleString()
                  : "—"}
              </dd>
            </div>
          </dl>

          {status === "error" && account?.last_error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {account.last_error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <form action={testRotessaConnection}>
              <button
                type="submit"
                className={SECONDARY_ACTION_CLASS}
              >
                Test connection
              </button>
            </form>
            <form action={disconnectRotessa}>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
              >
                Disconnect
              </button>
            </form>
          </div>

          {/* Export rent payments (the transaction report -> CSV) */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h4 className="text-sm font-semibold text-gray-700">Export rent payments</h4>
            <p className="mt-1 text-xs text-gray-500">
              Download your Rotessa payment history (amounts, dates, and status)
              as a CSV for bookkeeping or taxes. Leave the dates blank for
              everything.
            </p>
            <form action="/dashboard/rent/export" method="get" className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
                <input type="date" name="from" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
                <input type="date" name="to" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <button type="submit" className={SECONDARY_ACTION_CLASS}>
                Download CSV
              </button>
            </form>
          </div>

          {/* Replace / rotate the stored key */}
          <details className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">
              Replace API key or change environment
            </summary>
            <ConnectForm encConfigured={encConfigured} defaultEnv={account?.environment} submitLabel="Save & re-connect" />
          </details>
        </div>
      ) : (
        <div className="mt-4">
          <ConnectForm encConfigured={encConfigured} defaultEnv="sandbox" submitLabel="Connect Rotessa" />
        </div>
      )}
    </Card>
  );
}

function ConnectForm({
  encConfigured,
  defaultEnv,
  submitLabel,
}: {
  encConfigured: boolean;
  defaultEnv?: string;
  submitLabel: string;
}) {
  const env = defaultEnv === "live" ? "live" : "sandbox";
  return (
    <form action={connectRotessa} className="mt-4 space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">
          Rotessa API key
        </span>
        <input
          name="api_key"
          type="password"
          autoComplete="off"
          required
          placeholder="Paste your Rotessa API key"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
        />
        <span className="mt-1 block text-xs text-gray-400">
          Found in your Rotessa admin portal under API Keys. Stored encrypted; we
          only use it to schedule and read payment status.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">
          Environment
        </span>
        <select
          name="environment"
          defaultValue={env}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-64"
        >
          <option value="sandbox">Sandbox (test)</option>
          <option value="live">Live</option>
        </select>
        <span className="mt-1 block text-xs text-gray-400">
          Use Sandbox while testing; switch to Live to collect real rent.
        </span>
      </label>

      <button
        type="submit"
        disabled={!encConfigured}
        className={`${PRIMARY_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
        style={{ background: "var(--brand-gradient, var(--brand-color))" }}
      >
        {submitLabel}
      </button>
    </form>
  );
}
