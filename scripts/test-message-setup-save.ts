import assert from "node:assert/strict";
import { parseMessageSetup, messageSetupFlash } from "../lib/message-setup-save";

const f = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const all = {
  has_reply_to: "1", reply_to_email: " Rentals@AgileOnline.ca ",
  has_sms: "1", sms_enabled: "on",
  has_renter: "1", feedback_enabled: "on", feedback_delay_hours: "3", showing_arrival_phone: " 226-778-0014 ext 5 ",
  has_confirm: "1", showing_confirm_mode: "agent", auto_release_unconfirmed_enabled: "on", auto_release_unconfirmed_hours: "4",
  has_autoclose: "1", showing_autoclose_after_hours: "48",
  has_compliance: "1", compliance_calendar_enabled: "on",
};
const r = parseMessageSetup(f(all), { canRenterSms: true });
assert.ok(r.ok);
if (r.ok) {
  assert.deepEqual(r.replyTo, { present: true, value: "rentals@agileonline.ca" });
  assert.deepEqual(r.patch, {
    sms_enabled: true, feedback_enabled: true, feedback_delay_hours: 3, nurture_enabled: false,
    showing_arrival_phone: "226-778-0014 ext 5", showing_confirm_mode: "agent",
    auto_release_unconfirmed_enabled: true, auto_release_unconfirmed_hours: 4,
    showing_autoclose_enabled: false, showing_autoclose_after_hours: 48,
  });
  assert.deepEqual(r.compliance, { present: true, enabled: true });
}
// Cards not rendered are never read as "off".
const none = parseMessageSetup(f({}), { canRenterSms: false });
assert.ok(none.ok && Object.keys(none.patch).length === 0 && !none.replyTo.present && !none.compliance.present);
// Auto mode never keeps auto-release on.
const auto = parseMessageSetup(f({ ...all, showing_confirm_mode: "auto" }), { canRenterSms: true });
assert.ok(auto.ok && auto.patch.auto_release_unconfirmed_enabled === false);
// Any invalid card saves nothing.
const bad = (o: Record<string, string>, code: string, sms = true) => {
  const x = parseMessageSetup(f({ ...all, ...o }), { canRenterSms: sms });
  assert.ok(!x.ok && x.code === code, code);
};
bad({ reply_to_email: "not an email" }, "invalid_reply_to");
bad({ feedback_delay_hours: "1.5" }, "invalid_delay");
bad({ showing_confirm_mode: "" }, "invalid_confirm");
bad({ auto_release_unconfirmed_hours: "25" }, "invalid_confirm");
bad({ showing_autoclose_after_hours: "12" }, "invalid_autoclose");
bad({}, "sms_upgrade", false);
// Free plan with texting unticked saves fine.
const free = parseMessageSetup(f({ has_sms: "1" }), { canRenterSms: false });
assert.ok(free.ok && free.patch.sms_enabled === false);
assert.equal(messageSetupFlash("saved")?.tone, "green");
assert.equal(messageSetupFlash("nope"), null);
for (const c of ["saved","alias_paused","sms_upgrade","invalid_reply_to","invalid_delay","invalid_confirm","invalid_autoclose","compliance_forbidden","error"]) {
  assert.ok(!/—/.test(messageSetupFlash(c)!.text), "no em dash: " + c);
}
console.log("message-setup-save: all checks passed");
