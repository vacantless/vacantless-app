import Link from "next/link";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { BrandBanner, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";
import {
  MESSAGE_CHANNELS,
  channelLabel,
  commsErrorMessage,
} from "@/lib/tenant-comms";
import {
  saveMessageTemplate,
  deleteMessageTemplate,
} from "../../settings/comms-actions";

export const dynamic = "force-dynamic";

type TemplateRow = {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
};

export default async function TenantMessageTemplatesPage({
  searchParams,
}: {
  searchParams: { tpl?: string; tn?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  const supabase = createClient();
  const { data: templateRows } = await supabase
    .from("tenant_message_templates")
    .select("id, name, channel, subject, body")
    .order("name", { ascending: true });
  const templates = (templateRows ?? []) as TemplateRow[];

  const tplFlash =
    searchParams.tpl === "created"
      ? "Template created."
      : searchParams.tpl === "updated"
        ? "Template saved."
        : searchParams.tpl === "deleted"
          ? "Template deleted."
          : null;
  const tplError =
    searchParams.tpl && !["created", "updated", "deleted"].includes(searchParams.tpl)
      ? commsErrorMessage(searchParams.tpl)
      : null;

  return (
    <div>
      <BrandBanner
        eyebrow="Tenancies"
        title="Message templates"
        subtitle="Reusable email and text templates for tenant messages. Build them here once, then pick one while messaging from any tenancy."
        icon={<Icons.mail className="h-6 w-6" />}
      />

      <p className="mt-4 text-sm text-gray-500">
        <Link href="/dashboard/tenancies" className="font-medium text-brand underline">
          ← Back to Tenancies
        </Link>
      </p>

      <div className="mt-6 space-y-6">
        {tplFlash && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {tplFlash}
          </div>
        )}
        {tplError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {tplError}
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.mail className="h-4 w-4" /></IconTile>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Tenant messages
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Reusable message templates you can send to tenants from a tenancy
            (rent reminders, maintenance notices, and more). Use tokens like{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">{"{{first_name}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">{"{{property_address}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">{"{{rent}}"}</code> — they fill
            in per tenant when you send.
          </p>
          <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Used from any tenancy: open a tenancy, start a message, and pick a
            template to fill it in.
          </p>

          {/* Existing templates */}
          {templates.length > 0 && (
            <ul className="mt-4 space-y-3">
              {templates.map((tpl) => (
                <li key={tpl.id} className="rounded-xl border border-gray-200 p-4">
                  <form action={saveMessageTemplate} className="space-y-3">
                    <input type="hidden" name="id" value={tpl.id} />
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="min-w-[12rem] flex-1">
                        <span className="mb-1 block text-xs font-medium text-gray-600">Name</span>
                        <input name="name" defaultValue={tpl.name} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      </label>
                      <label className="w-44">
                        <span className="mb-1 block text-xs font-medium text-gray-600">Channel</span>
                        <select name="channel" defaultValue={tpl.channel} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                          {MESSAGE_CHANNELS.map((c) => (
                            <option key={c} value={c}>{channelLabel(c)}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-600">
                        Subject <span className="text-gray-400">(used for email)</span>
                      </span>
                      <input name="subject" defaultValue={tpl.subject ?? ""} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-600">Message</span>
                      <textarea name="body" rows={3} defaultValue={tpl.body} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </label>
                    <div className="flex items-center gap-2">
                      <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                        Save
                      </button>
                    </div>
                  </form>
                  <form action={deleteMessageTemplate} className="mt-2">
                    <input type="hidden" name="id" value={tpl.id} />
                    <button className="text-xs font-medium text-red-600 hover:text-red-700">
                      Delete template
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {/* Create new template */}
          <form
            // Keyed on the post-submit nonce so a successful create REMOUNTS this
            // form and clears its uncontrolled inputs (S226 QA-audit form-reset).
            key={`new-tpl-${searchParams.tn ?? "new"}`}
            action={saveMessageTemplate}
            className="mt-5 space-y-3 border-t border-gray-100 pt-5"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              New template
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[12rem] flex-1">
                <span className="mb-1 block text-xs font-medium text-gray-600">Name</span>
                <input name="name" placeholder="e.g. Rent due reminder" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label className="w-44">
                <span className="mb-1 block text-xs font-medium text-gray-600">Channel</span>
                <select name="channel" defaultValue="email" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {MESSAGE_CHANNELS.map((c) => (
                    <option key={c} value={c}>{channelLabel(c)}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                Subject <span className="text-gray-400">(used for email)</span>
              </span>
              <input name="subject" placeholder="Rent reminder for {{property_address}}" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Message</span>
              <textarea name="body" rows={3} placeholder={"Hi {{first_name}}, a reminder that rent of {{rent}} is due..."} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm">
              Add template
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
