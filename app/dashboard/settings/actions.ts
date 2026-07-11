"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  validateBrandIdentity,
  validateReplyToEmail,
  validateFeedbackDelayHours,
} from "@/lib/branding";
import { validateTestRecipient } from "@/lib/test-email";
import { validateScreeningSettings } from "@/lib/screening";
import {
  validateNewQuestion,
  normalizePreferredAnswer,
} from "@/lib/screening-questions";
import { validatePublicContact } from "@/lib/public-contact";
import {
  validatePolicyProfileSettings,
  validateBuildingPolicySettings,
} from "@/lib/policy-profile";
import { sendTestEmail } from "@/lib/email";
import { canUseRenterSms } from "@/lib/billing";
import {
  validateLogoUpload,
  extForLogoType,
  logoStoragePath,
} from "@/lib/logo";

const LOGO_BUCKET = "org-logos";

// ===========================================================================
// Per-tab settings saves (S227 Settings restructure). The old single
// `updateBranding` form was split into four focused actions, each owning one
// tab/section's fields and redirecting back to the tab it lives on. All four
// require manage_settings and are redirect-based for the same reason the old
// action was: revalidate-only server actions intermittently 503 at the Vercel
// edge and the page does not refresh even though the write commits (S170 WATCH);
// a redirect-based action follows the redirect and is unaffected.
// ===========================================================================

// Shared guard: settings are admin/operator only (locked seat model) — a
// showing helper can't touch account settings.
async function requireSettingsOrg() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_settings", "/dashboard/settings?forbidden=1");
  return org;
}

// Tab 1 — Public Page & Brand: business name + brand color(s).
export async function updateBrandIdentity(formData: FormData) {
  const org = await requireSettingsOrg();

  const result = validateBrandIdentity({
    name: String(formData.get("name") ?? ""),
    brand_color: String(formData.get("brand_color") ?? ""),
    brand_color_secondary: String(formData.get("brand_color_secondary") ?? ""),
  });
  if (!result.ok) {
    redirect("/dashboard/settings?tab=brand&error=1");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update(result.values)
    .eq("id", org.id);
  if (error) {
    redirect("/dashboard/settings?tab=brand&error=save");
  }

  redirect("/dashboard/settings?tab=brand&saved=1");
}

// Renter pre-screening. Governs the qualifying questions on the public inquiry
// form + the auto qualify-out flag. Default off. IA Step 3 (S275): the editor
// lives at its point-of-use — /dashboard/leasing/screening. S438 page-hierarchy
// split the old single save into two independent saves so the page can put WHICH
// questions are asked near the top and the auto-flag RULES in their own card
// lower down: updateScreeningQuestions owns the master switch + per-built-in ask
// toggles; updateScreeningFlags owns the flag thresholds + reason copy. Each does
// a PARTIAL update of only its own columns, so saving one never disturbs the other.

// Card 1 (top): the master switch + which built-in questions the renter form asks.
export async function updateScreeningQuestions(formData: FormData) {
  const org = await requireSettingsOrg();

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      screening_enabled: formData.get("screening_enabled") != null,
      // An unchecked box submits nothing, so absence = false ("don't ask it").
      screening_ask_income: formData.get("screening_ask_income") != null,
      screening_ask_movein: formData.get("screening_ask_movein") != null,
      screening_ask_pets: formData.get("screening_ask_pets") != null,
      screening_ask_occupants: formData.get("screening_ask_occupants") != null,
    })
    .eq("id", org.id);
  if (error) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  redirect("/dashboard/leasing/screening?screening=questions_saved");
}

// Card 2 (lower): the auto-flag thresholds + operator-custom reason copy. Reuses
// validateScreeningSettings for the numeric validation; enabled/ask are not this
// action's concern (dummy true), and only the flag + reason columns are written.
export async function updateScreeningFlags(formData: FormData) {
  const org = await requireSettingsOrg();

  const result = validateScreeningSettings({
    enabled: true,
    income_multiple: String(formData.get("screening_income_multiple") ?? ""),
    max_movein_days: String(formData.get("screening_max_movein_days") ?? ""),
    flag_pets: formData.get("screening_flag_pets") != null,
    reason_income: String(formData.get("screening_reason_income") ?? ""),
    reason_movein: String(formData.get("screening_reason_movein") ?? ""),
    reason_pets: String(formData.get("screening_reason_pets") ?? ""),
  });
  if (!result.ok) {
    redirect(`/dashboard/leasing/screening?screening=${result.reason}`);
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      screening_income_multiple: result.values.screening_income_multiple,
      screening_max_movein_days: result.values.screening_max_movein_days,
      screening_flag_pets: result.values.screening_flag_pets,
      screening_reason_income: result.values.screening_reason_income,
      screening_reason_movein: result.values.screening_reason_movein,
      screening_reason_pets: result.values.screening_reason_pets,
    })
    .eq("id", org.id);
  if (error) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  redirect("/dashboard/leasing/screening?screening=flags_saved");
}

// Custom pre-screening questions (S291). Operator authors arbitrary questions
// that render on the public inquiry form alongside the three built-ins. v1 is
// informational only — answers are captured + shown, never drive qualify-out.
// Both actions redirect back to the screening page (same 503-avoidance reason as
// the rest of the settings saves).
export async function addScreeningQuestion(formData: FormData) {
  const org = await requireSettingsOrg();

  const result = validateNewQuestion({
    prompt: String(formData.get("prompt") ?? ""),
    qtype: String(formData.get("qtype") ?? ""),
    preferredAnswer: String(formData.get("preferred_answer") ?? ""),
    // S294: choice options (one per line). Ignored for text/yesno.
    choices: String(formData.get("choices") ?? ""),
  });
  if (!result.ok) {
    redirect(`/dashboard/leasing/screening?screening=question_${result.reason}`);
  }

  const supabase = createClient();
  // Append after the existing questions. RLS scopes the read to this org.
  const { data: last } = await supabase
    .from("org_screening_questions")
    .select("position")
    .eq("organization_id", org.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (last?.position ?? 0) + 1;

  const { error } = await supabase.from("org_screening_questions").insert({
    organization_id: org.id,
    prompt: result.values.prompt,
    qtype: result.values.qtype,
    // S293: only a yes/no question can carry a preference; validateNewQuestion
    // already normalized it to null for text questions / unrecognized values.
    preferred_answer: result.values.preferredAnswer,
    // S294: choice options; validateNewQuestion already normalized this to [] for
    // text/yesno and to a deduped/trimmed list (>=2) for a choice question.
    choices: result.values.choices,
    position: nextPosition,
  });
  if (error) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  redirect("/dashboard/leasing/screening?screening=question_added");
}

// Pause / resume a custom question (S438). Turning it OFF (active=false) stops it
// rendering on the public inquiry form but keeps the definition so the operator
// can turn it back ON later without re-authoring it — the "pause without delete"
// the operator UX asked for. This replaces the old single "Remove" (which was a
// soft delete = active=false); a true delete is deleteScreeningQuestion below.
// The desired state rides in a hidden `active` field ("1"/"0"). Existing lead
// snapshots are self-contained (screen_custom_answers carries its own prompt), so
// pausing/resuming never rewrites answers already filed.
export async function setScreeningQuestionActive(formData: FormData) {
  const org = await requireSettingsOrg();
  const id = String(formData.get("question_id") ?? "").trim();
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  const supabase = createClient();
  // RLS plus the explicit org filter prevent touching another org's question.
  const { error } = await supabase
    .from("org_screening_questions")
    .update({ active })
    .eq("id", id)
    .eq("organization_id", org.id);
  if (error) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  redirect(
    `/dashboard/leasing/screening?screening=${active ? "question_resumed" : "question_paused"}`,
  );
}

// Permanently delete a custom question (S438). Offered only on an already-off
// (paused) question in the UI, so it is a deliberate two-step action, not a
// one-click loss. A hard delete is safe: leads.screen_custom_answers is a
// self-contained snapshot (no FK to this row), so past inquiries keep their
// answers even after the question row is gone.
export async function deleteScreeningQuestion(formData: FormData) {
  const org = await requireSettingsOrg();
  const id = String(formData.get("question_id") ?? "").trim();
  if (!id) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  const supabase = createClient();
  // RLS plus the explicit org filter prevent touching another org's question.
  const { error } = await supabase
    .from("org_screening_questions")
    .delete()
    .eq("id", id)
    .eq("organization_id", org.id);
  if (error) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  redirect("/dashboard/leasing/screening?screening=question_deleted");
}

// Set / clear the operator's preferred answer on an EXISTING yes/no question
// (S293, the v2 soft flag). The preference is informational only — a mismatch
// shows a soft heads-up on the lead, it never drives qualified_out. We re-read
// the question's qtype server-side and run it through normalizePreferredAnswer,
// so a preference can never be attached to a text question even if the form is
// tampered with. An empty / "none" value clears the preference.
export async function updateScreeningPreferredAnswer(formData: FormData) {
  const org = await requireSettingsOrg();
  const id = String(formData.get("question_id") ?? "").trim();
  if (!id) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  const supabase = createClient();
  // Read the question's type (scoped to this org by RLS + the explicit filter)
  // so the preference can only ever apply to a yes/no question.
  const { data: q } = await supabase
    .from("org_screening_questions")
    .select("qtype")
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!q) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  const preferred = normalizePreferredAnswer(
    q.qtype === "yesno" ? "yesno" : "text",
    String(formData.get("preferred_answer") ?? ""),
  );

  const { error } = await supabase
    .from("org_screening_questions")
    .update({ preferred_answer: preferred })
    .eq("id", id)
    .eq("organization_id", org.id);
  if (error) {
    redirect("/dashboard/leasing/screening?screening=error");
  }

  redirect("/dashboard/leasing/screening?screening=preference_saved");
}

// Tab 1 — Public Page & Brand: public contact details for the syndication feed.
// The phone is the aggregator-required account contact (Rentsync/Zumper); the
// email is optional (feed falls back to reply-to). Both blank is valid = unset.
export async function updatePublicContact(formData: FormData) {
  const org = await requireSettingsOrg();

  const result = validatePublicContact({
    phone: String(formData.get("public_contact_phone") ?? ""),
    email: String(formData.get("public_contact_email") ?? ""),
  });
  if (!result.ok) {
    redirect(`/dashboard/settings?tab=brand&feed=${result.field}`);
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update(result.values)
    .eq("id", org.id);
  if (error) {
    redirect("/dashboard/settings?tab=brand&feed=error");
  }

  redirect("/dashboard/settings?tab=brand&feed=saved");
}

// Building STANDARD POLICY profile (0048). The org-level defaults (lease term /
// smoking / A/C type / on-site management) every unit inherits unless it
// overrides them. IA Step 3 (S275): the editor moved to its point-of-use —
// /dashboard/properties/standard-policy (the Rentals/building context) — so the
// redirects land there. The per-unit property form still shows the inherited
// value with an "override for this unit" affordance.
export async function updatePolicyProfile(formData: FormData) {
  const org = await requireSettingsOrg();

  const result = validatePolicyProfileSettings({
    lease_term: String(formData.get("policy_lease_term") ?? ""),
    smoking: String(formData.get("policy_smoking") ?? ""),
    ac_type: String(formData.get("policy_ac_type") ?? ""),
    on_site_management: String(formData.get("policy_on_site_management") ?? ""),
    // Utilities + pets defaults (0050).
    heat_included: String(formData.get("policy_heat_included") ?? ""),
    hydro_included: String(formData.get("policy_hydro_included") ?? ""),
    water_included: String(formData.get("policy_water_included") ?? ""),
    pets_cats: String(formData.get("policy_pets_cats") ?? ""),
    pets_dogs: String(formData.get("policy_pets_dogs") ?? ""),
    pets_dog_size: String(formData.get("policy_pets_dog_size") ?? ""),
  });

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update(result.values)
    .eq("id", org.id);
  if (error) {
    redirect("/dashboard/properties/standard-policy?policy=error");
  }

  redirect("/dashboard/properties/standard-policy?policy=saved");
}

// Per-BUILDING standard-policy override (0049, slice 2 — the hybrid layer). Each
// building (units sharing a normalized address = properties.building_key) can
// override the org defaults; every unit in that building inherits the building
// value unless the unit itself overrides it (resolution: unit > building > org).
// All four fields are tri-state ("" = inherit). When the operator sets every
// field back to "inherit" we DELETE the row rather than store an all-null no-op,
// so org_building_policies only holds genuine overrides.
export async function updateBuildingPolicy(formData: FormData) {
  const org = await requireSettingsOrg();

  const buildingKey = String(formData.get("building_key") ?? "").trim();
  if (!buildingKey) {
    redirect("/dashboard/properties/standard-policy?policy=error");
  }

  const { values, allInherit } = validateBuildingPolicySettings({
    lease_term: String(formData.get("policy_lease_term") ?? ""),
    smoking: String(formData.get("policy_smoking") ?? ""),
    ac_type: String(formData.get("policy_ac_type") ?? ""),
    on_site_management: String(formData.get("policy_on_site_management") ?? ""),
    // Utilities + pets overrides (0050).
    heat_included: String(formData.get("policy_heat_included") ?? ""),
    hydro_included: String(formData.get("policy_hydro_included") ?? ""),
    water_included: String(formData.get("policy_water_included") ?? ""),
    pets_cats: String(formData.get("policy_pets_cats") ?? ""),
    pets_dogs: String(formData.get("policy_pets_dogs") ?? ""),
    pets_dog_size: String(formData.get("policy_pets_dog_size") ?? ""),
  });

  const supabase = createClient();

  if (allInherit) {
    // Nothing overridden — drop any existing override row for this building so
    // it cleanly falls back to the org default.
    const { error } = await supabase
      .from("org_building_policies")
      .delete()
      .eq("organization_id", org.id)
      .eq("building_key", buildingKey);
    if (error) {
      redirect("/dashboard/properties/standard-policy?policy=error");
    }
    redirect("/dashboard/properties/standard-policy?policy=saved");
  }

  const { error } = await supabase.from("org_building_policies").upsert(
    {
      organization_id: org.id,
      building_key: buildingKey,
      ...values,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,building_key" },
  );
  if (error) {
    redirect("/dashboard/properties/standard-policy?policy=error");
  }

  redirect("/dashboard/properties/standard-policy?policy=saved");
}

// Tab 2 / Email sender — reply-to address renter emails are delivered to.
export async function updateEmailSender(formData: FormData) {
  const org = await requireSettingsOrg();

  const replyTo = validateReplyToEmail(String(formData.get("reply_to_email") ?? ""));
  if (!replyTo.ok) {
    redirect("/dashboard/settings?tab=comms&sender=invalid");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ reply_to_email: replyTo.value })
    .eq("id", org.id);
  if (error) {
    redirect("/dashboard/settings?tab=comms&sender=error");
  }

  redirect("/dashboard/settings?tab=comms&sender=saved");
}

// Tab 2 / Renter messages — post-viewing feedback + automatic follow-up.
export async function updateRenterMessages(formData: FormData) {
  const org = await requireSettingsOrg();

  const delay = validateFeedbackDelayHours(
    String(formData.get("feedback_delay_hours") ?? ""),
  );
  if (!delay.ok) {
    redirect("/dashboard/settings?tab=comms&renter=invalid");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      // Both are checkboxes that always submit with this form, so absence means
      // unchecked = off (no opt-in/opt-out ambiguity once the field is in-form).
      feedback_enabled: formData.get("feedback_enabled") != null,
      feedback_delay_hours: delay.value,
      nurture_enabled: formData.get("nurture_enabled") != null,
    })
    .eq("id", org.id);
  if (error) {
    redirect("/dashboard/settings?tab=comms&renter=error");
  }

  redirect("/dashboard/settings?tab=comms&renter=saved");
}

// Tab 2 / Text messages — SMS reminders (OPT-IN: off unless explicitly turned on).
export async function updateTextMessages(formData: FormData) {
  const org = await requireSettingsOrg();

  // Renter SMS is a Growth+ capability. Block turning it ON on a plan that can't
  // send renter texts (Codex P2 "Free = no texting"); turning it OFF is always
  // allowed. This is the primary gate — the booking + reminder send sites also
  // re-check the plan defensively.
  const wantsOn = formData.get("sms_enabled") != null;
  if (wantsOn && !canUseRenterSms(org.plan)) {
    redirect("/dashboard/settings?tab=comms&sms=upgrade");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ sms_enabled: wantsOn })
    .eq("id", org.id);
  if (error) {
    redirect("/dashboard/settings?tab=comms&sms=error");
  }

  redirect("/dashboard/settings?tab=comms&sms=saved");
}

// Send the operator a copy of their branded renter auto-reply so they can
// confirm deliverability + branding before going live. Redirect-based (same
// reasoning as updateBranding re: the S170 edge-503 WATCH). The result reason
// drives a precise on-page banner.
export async function sendTestEmailAction(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  // Org settings + branding are admin/operator only (locked seat model): a
  // showing helper can't touch account settings.
  await requireCapability("manage_settings", "/dashboard/settings?forbidden=1");

  const recipient = validateTestRecipient(String(formData.get("test_email") ?? ""));
  if (!recipient.ok) {
    redirect("/dashboard/settings?tab=comms&test=invalid");
  }

  const result = await sendTestEmail({
    to_email: recipient.value,
    org_name: org.name,
    brand_color: org.brand_color,
    logo_url: org.logo_url,
    reply_to_email: org.reply_to_email,
  });

  if (!result.sent) {
    // Distinguish "email isn't wired up yet" from a genuine send failure so the
    // operator knows whether it's a config gap or something to retry.
    redirect(
      result.reason === "no_api_key"
        ? "/dashboard/settings?tab=comms&test=nokey"
        : "/dashboard/settings?tab=comms&test=failed",
    );
  }

  redirect(
    `/dashboard/settings?tab=comms&test=sent&to=${encodeURIComponent(recipient.value)}`,
  );
}

// ===========================================================================
// Org logo — upload + remove (Supabase Storage, bucket org-logos, migration
// 0020). The file rides this server action as multipart FormData (the 30mb
// body cap in next.config covers it; a logo is validated at 2 MB). Validation
// is in lib/logo; the storage RLS is the backstop. Redirect-based for the same
// S170 edge-503 reasoning as updateBranding.
// ===========================================================================

// One logo per org: clear the org's folder before writing a fresh file so we
// never leave orphaned objects, and a new filename each time so the public CDN
// URL changes (no stale-cache on replace).
async function clearOrgLogoFolder(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
) {
  // The authenticated SELECT policy (migration 0025) is what lets .list() see
  // the org's objects and remove() delete them; before it, both silently
  // no-op'd and orphaned the old logo on every replace/remove. Log failures
  // instead of swallowing them.
  const { data: existing, error: listErr } = await supabase.storage
    .from(LOGO_BUCKET)
    .list(orgId);
  if (listErr) {
    console.error("clearOrgLogoFolder: list failed", {
      orgId,
      error: listErr.message,
    });
    return;
  }
  if (existing && existing.length > 0) {
    const { error: rmErr } = await supabase.storage
      .from(LOGO_BUCKET)
      .remove(existing.map((f) => `${orgId}/${f.name}`));
    if (rmErr) {
      console.error("clearOrgLogoFolder: remove failed", {
        orgId,
        error: rmErr.message,
      });
    }
  }
}

export async function uploadOrgLogo(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  // Org settings + branding are admin/operator only (locked seat model): a
  // showing helper can't touch account settings.
  await requireCapability("manage_settings", "/dashboard/settings?forbidden=1");

  const entry = formData.get("logo");
  const file =
    typeof entry === "object" &&
    entry !== null &&
    "size" in entry &&
    "type" in entry
      ? (entry as File)
      : null;

  if (!file || file.size === 0) {
    redirect("/dashboard/settings?tab=brand&logoerr=empty");
  }

  const v = validateLogoUpload({ type: file.type, size: file.size });
  if (!v.ok) {
    redirect(`/dashboard/settings?tab=brand&logoerr=${v.reason}`);
  }

  const supabase = createClient();
  await clearOrgLogoFolder(supabase, org.id);

  const path = logoStoragePath(
    org.id,
    crypto.randomUUID(),
    extForLogoType(file.type),
  );
  const { error: upErr } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) {
    redirect("/dashboard/settings?tab=brand&logoerr=failed");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);

  const { error: dbErr } = await supabase
    .from("organizations")
    .update({ logo_url: publicUrl })
    .eq("id", org.id);
  if (dbErr) {
    // Roll back the orphaned object so Storage + the row stay in sync.
    const { error: rbErr } = await supabase.storage
      .from(LOGO_BUCKET)
      .remove([path]);
    if (rbErr) {
      console.error("uploadOrgLogo: rollback remove failed", {
        path,
        error: rbErr.message,
      });
    }
    redirect("/dashboard/settings?tab=brand&logoerr=failed");
  }

  redirect("/dashboard/settings?tab=brand&logo=saved");
}

export async function removeOrgLogo() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  // Org settings + branding are admin/operator only (locked seat model): a
  // showing helper can't touch account settings.
  await requireCapability("manage_settings", "/dashboard/settings?forbidden=1");

  const supabase = createClient();
  // Best-effort object cleanup, then null the column (the column is the source
  // of truth for what the public page + emails render).
  await clearOrgLogoFolder(supabase, org.id);
  await supabase
    .from("organizations")
    .update({ logo_url: null })
    .eq("id", org.id);

  redirect("/dashboard/settings?tab=brand&logo=removed");
}
