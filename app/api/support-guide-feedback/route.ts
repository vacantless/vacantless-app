import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

const FEEDBACK_TYPES = new Set(["helpful", "stuck"]);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const pagePath =
    typeof input.pagePath === "string" ? input.pagePath.trim() : "";
  const topicKey =
    typeof input.topicKey === "string" ? input.topicKey.trim() : "";
  const feedbackType =
    typeof input.feedbackType === "string" ? input.feedbackType : "";
  const comment =
    typeof input.comment === "string" ? input.comment.trim().slice(0, 1000) : null;

  if (
    !pagePath.startsWith("/") ||
    pagePath.startsWith("//") ||
    pagePath.length > 300 ||
    !/^[a-z0-9-]{1,80}$/i.test(topicKey) ||
    !FEEDBACK_TYPES.has(feedbackType)
  ) {
    return NextResponse.json({ error: "Invalid feedback." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const organization = await getCurrentOrg();
  const { error } = await supabase.from("support_guide_feedback").insert({
    organization_id: organization?.id ?? null,
    user_id: user.id,
    page_path: pagePath,
    topic_key: topicKey,
    feedback_type: feedbackType,
    comment: comment || null,
  });

  if (error) {
    console.error("support guide feedback insert failed", {
      code: error.code,
    });
    return NextResponse.json(
      { error: "Feedback could not be saved." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
