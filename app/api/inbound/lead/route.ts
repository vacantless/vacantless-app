import type { NextRequest } from "next/server";
import { handleInboundLeadPost } from "@/lib/portal-lead-ingest-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleInboundLeadPost(req);
}
