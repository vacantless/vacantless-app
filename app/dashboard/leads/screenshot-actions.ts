"use server";

// S702: add a renter from a chat screenshot. Step 1 reads the screenshot with
// AI and returns a draft. Step 2 saves the renter after the landlord checks it.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { normalizePhoneE164 } from "@/lib/sms";
import { normalizeEmail } from "@/lib/persons";
import { aiConfigured } from "@/lib/ai-call";
import { openRentalsForOrg, readScreenshotWithAi } from "@/lib/ai-enquiry-server";
import { checkScreenshot, screenshotSource } from "@/lib/ai-screenshot-lead";

export type ScreenshotDraft = {
  name: string;
  email: string;
  phone: string;
  question: string;
  site: string;
  propertyId: string;
};

export type ReadScreenshotResult =
  | { ok: true; draft: ScreenshotDraft }
  | { ok: false; error: string };

export async function readScreenshot(formData: FormData): Promise<ReadScreenshotResult> {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: "Please sign in again." };
  if (!aiConfigured()) return { ok: false, error: "Screenshot reading is not available right now." };

  const file = formData.get("screenshot");
  const f = file instanceof File ? file : null;
  const check = checkScreenshot(f);
  if (!check.ok) {
    return {
      ok: false,
      error:
        check.reason === "missing"
          ? "Choose a screenshot first."
          : check.reason === "type"
            ? "Use a PNG or JPG picture."
            : "That picture is too big. Use one under 5 MB.",
    };
  }
  const supabase = createClient();
  const rentals = await openRentalsForOrg(supabase, org.id);
  const base64 = Buffer.from(await f!.arrayBuffer()).toString("base64");
  const read = await readScreenshotWithAi({ mediaType: f!.type, base64 }, rentals);
  if (!read) return { ok: false, error: "We could not read that picture. Try again, or type the details in." };
  return {
    ok: true,
    draft: {
      name: read.name ?? "",
      email: read.email ?? "",
      phone: read.phone ?? "",
      question: read.question ?? "",
      site: read.site ?? "",
      propertyId: read.rentalId ?? "",
    },
  };
}

export async function addRenterFromScreenshot(formData: FormData): Promise<void> {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const org = await getCurrentOrg();
  if (!org) redirect("/dashboard/leads");
  const supabase = createClient();

  const text = (k: string, max: number) => String(formData.get(k) ?? "").trim().slice(0, max);
  const name = text("name", 120) || null;
  const email = normalizeEmail(text("email", 200)) || null;
  const phone = text("phone", 40) || null;
  const question = text("question", 400);
  const site = text("site", 40);
  let propertyId: string | null = text("property_id", 64) || null;

  if (!email && !phone) redirect("/dashboard/leads?screenshot=need_contact");

  if (propertyId) {
    const { data: prop } = await supabase
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .eq("organization_id", org!.id)
      .maybeSingle();
    if (!prop) propertyId = null;
  }

  const notes = [question ? `Asked: ${question}` : null, "Added from a chat screenshot."]
    .filter(Boolean)
    .join("\n");
  const { data, error } = await supabase
    .from("leads")
    .insert({
      organization_id: org!.id,
      property_id: propertyId,
      name,
      email,
      phone,
      phone_e164: normalizePhoneE164(phone),
      source: screenshotSource(site),
      status: "new",
      notes,
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) redirect("/dashboard/leads?screenshot=failed");
  revalidatePath("/dashboard/leads");
  redirect(`/dashboard/leads/${data!.id}`);
}
