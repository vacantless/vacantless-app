// No-install pop-out SIDECAR route (Lane C, S484). A same-origin companion window
// for the browser co-pilot: an operator opens this from the Distribute tab's
// co-pilot panel ("Open co-pilot window"), gets the channel-fit copy + steps, and
// completes the post by pasting the live URL — WITHOUT installing the S483 Chrome
// extension. All data is rebuilt server-side for a single run item by
// loadCopilotSidecar (RLS-scoped, same pure libs as the Distribute tab). No new
// server surface: completion posts to the existing completeCopilotPost action.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { loadCopilotSidecar } from "@/lib/copilot-sidecar";
import { SidecarCopilot } from "./sidecar-copilot";

export const dynamic = "force-dynamic";

export default async function CopilotSidecarPage({
  params,
}: {
  params: { id: string; itemId: string };
}) {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const publicUrl = host
    ? `${proto}://${host}/r/${params.id}`
    : `/r/${params.id}`;

  const data = await loadCopilotSidecar({
    propertyId: params.id,
    itemId: params.itemId,
    publicUrl,
  });
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <SidecarCopilot
        propertyId={data.propertyId}
        itemId={data.itemId}
        channelLabel={data.channelLabel}
        script={data.script}
      />
    </div>
  );
}
