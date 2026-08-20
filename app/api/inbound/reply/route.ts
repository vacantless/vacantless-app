import type { NextRequest } from "next/server";
import { handleInboundReplyPost } from "@/lib/renter-reply-ingest-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleInboundReplyPost(req);
}
