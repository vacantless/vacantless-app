// Run with: npx tsx scripts/test-notification-actions.ts
//
// Focused unit test for the branded notification shell's S511 action-row
// support. No network: notificationHtml is pure.

import { notificationHtml, type NotificationEmailPayload } from "../lib/email";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const base: NotificationEmailPayload = {
  to_email: "agent@example.com",
  subject: "How did the viewing go?",
  body: "Please record the outcome.",
  org_name: "Agile Rentals",
  brand_color: "#2255aa",
  accent_color: null,
  logo_url: null,
  reply_to_email: null,
};

const actionRowHtml = notificationHtml({
  ...base,
  action_label: "Record the outcome",
  action_url: "https://app.example/showing/legacy",
  actions: [
    {
      label: "Renter showed",
      url: "https://app.example/agent/agent-token/record?showing=showing-1&o=attended",
      variant: "primary",
    },
    {
      label: "No-show",
      url: "https://app.example/agent/agent-token/record?showing=showing-1&o=no_show",
      variant: "secondary",
    },
  ],
});

ok("actions renders one anchor per action", count(actionRowHtml, "<a href=") === 2);
ok(
  "actions renders primary branded button",
  actionRowHtml.includes(
    '<a href="https://app.example/agent/agent-token/record?showing=showing-1&amp;o=attended" style="display:inline-block;background:#2255aa;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin:0 4px 8px;">Renter showed</a>',
  ),
);
ok(
  "actions renders secondary bordered button",
  actionRowHtml.includes(
    '<a href="https://app.example/agent/agent-token/record?showing=showing-1&amp;o=no_show" style="display:inline-block;background:#ffffff;color:#3f3f46;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;border:1px solid #d4d4d8;margin:0 4px 8px;">No-show</a>',
  ),
);
ok(
  "actions render buttons only — no raw-URL fallback list (S511b)",
  !actionRowHtml.includes("&rarr;") && !actionRowHtml.includes("word-break:break-all"),
);
ok("actions suppresses legacy single action url", !actionRowHtml.includes("https://app.example/showing/legacy"));
ok(
  "actions drop the multi-button fallback copy (S511b)",
  !actionRowHtml.includes("If a button does not open"),
);

const singleHtml = notificationHtml({
  ...base,
  action_label: "Record the outcome",
  action_url: "https://app.example/showing/tok",
});

const expectedSingleAction = `
      <p style="margin:0 0 16px;text-align:center;">
        <a href="https://app.example/showing/tok" style="display:inline-block;background:#2255aa;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Record the outcome</a>
      </p>
      <p style="margin:0 0 8px;font-size:14px;color:#3f3f46;">If the button does not open, copy and paste this link into your browser:</p>
      <p style="margin:0 0 16px;padding:12px;background:#f4f4f5;border-radius:8px;font-size:14px;color:#3f3f46;word-break:break-all;">https://app.example/showing/tok</p>`;

ok("single action renders exactly the legacy CTA block", singleHtml.includes(expectedSingleAction));
ok("single action renders one anchor", count(singleHtml, "<a href=") === 1);
ok("single action keeps legacy fallback copy", singleHtml.includes("If the button does not open"));
ok("single action does not render action-row fallback", !singleHtml.includes("&rarr;"));

console.log(`\nnotification-actions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
