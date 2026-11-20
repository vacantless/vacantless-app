import type { Metadata } from "next";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPhoneSetupLink } from "@/lib/phone-setup-server";
import { PHONE_SETUP_STATE_LINE, phoneKind, phoneSetupState } from "@/lib/phone-setup";
import { SEND_SHORTCUT_FILE } from "@/lib/send-shortcut-copy";
import { PhoneSetup } from "./phone-setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Set up your phone",
  robots: { index: false, follow: false },
};

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

// S824d: the page the QR code on Quick replies opens. Reading it changes
// nothing (a link preview or prefetch is safe); only the tap uses the code.
export default async function PhoneSetupPage({ params }: { params: { token: string } }) {
  const admin = createAdminClient();
  const row = admin ? await readPhoneSetupLink(admin, params.token) : null;
  const state = phoneSetupState(row, Date.now());
  const kind = phoneKind(headers().get("user-agent"));
  const shortcutUrl = process.env.NEXT_PUBLIC_SEND_SHORTCUT_URL?.trim() || `${APP_URL}${SEND_SHORTCUT_FILE}`;

  return (
    <main className="mx-auto max-w-md px-5 py-10 text-gray-800">
      <h1 className="text-xl font-semibold text-gray-900">Set up Vacantless on this phone</h1>
      {/* S825a: one component either way, so its "key copied" panel stays after the sign-in refresh. */}
      <PhoneSetup
        token={params.token}
        kind={kind}
        shortcutUrl={shortcutUrl}
        stateLine={state === "ready" ? null : PHONE_SETUP_STATE_LINE[state]}
      />
    </main>
  );
}
