import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDocumentDownloadUrl } from "@/lib/documents-server";
import { accessibleBrand, brandGradientCss } from "@/lib/brand-theme";
import { isShareLinkValid, formatBytes, documentTypeLabel } from "@/lib/documents";

export const dynamic = "force-dynamic";

// The share token is a bearer credential to a private document. Keep these pages
// out of every index — they must never be crawled or cached by search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Public, account-less, read-only document viewer (document vault Slice 2). The
// share token is the recipient's ONLY handle (the magic-link pattern used by
// /sign, /report, /job). Because the recipient has no Supabase account, this
// page reads with the service-role admin client — which BYPASSES RLS — so it
// must re-validate the token and re-derive the org/document/path entirely
// server-side before minting a signed URL (feedback_anon_rpc_revalidate_server_side):
//   1. look up the share link by token,
//   2. confirm it is not revoked and not expired,
//   3. confirm the document still exists and is not soft-deleted,
//   4. mint a SHORT-LIVED signed URL for exactly that document's stored path,
//   5. log the access (count + last-accessed).
// Any failure => notFound() (a generic 404, never a reason that leaks state).

type DocInfo = {
  signedUrl: string;
  title: string;
  docType: string;
  mimeType: string;
  sizeBytes: number;
  orgName: string;
  brandColor: string | null;
  brandColorSecondary: string | null;
  logoUrl: string | null;
};

async function resolveShare(token: string): Promise<DocInfo | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  // 1. The share link.
  const { data: linkRow } = await admin
    .from("document_share_links")
    .select("id, document_id, organization_id, expires_at, revoked_at, access_count")
    .eq("token", token)
    .maybeSingle();
  if (!linkRow) return null;
  const link = linkRow as {
    id: string;
    document_id: string;
    organization_id: string;
    expires_at: string | null;
    revoked_at: string | null;
    access_count: number;
  };

  // 2. Validity (not revoked, not expired).
  if (!isShareLinkValid(link, new Date())) return null;

  // 3. The document (re-derive org + path; block soft-deleted).
  const { data: docRow } = await admin
    .from("documents")
    .select("id, organization_id, title, doc_type, mime_type, size_bytes, storage_path, deleted_at")
    .eq("id", link.document_id)
    .maybeSingle();
  if (!docRow) return null;
  const doc = docRow as {
    id: string;
    organization_id: string;
    title: string;
    doc_type: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    deleted_at: string | null;
  };
  if (doc.deleted_at) return null;
  // Defense in depth: the link's org must own the document.
  if (doc.organization_id !== link.organization_id) return null;

  // 4. Mint a short-lived signed URL for exactly that path.
  const signed = await createDocumentDownloadUrl(admin, doc.storage_path);
  if (!signed.ok) return null;

  // 5. Log the access (best-effort — never block the view on the counter).
  await admin
    .from("document_share_links")
    .update({
      access_count: (link.access_count ?? 0) + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("id", link.id);

  // Branding for the viewer chrome.
  const { data: orgRow } = await admin
    .from("organizations")
    .select("name, brand_color, brand_color_secondary, logo_url")
    .eq("id", doc.organization_id)
    .maybeSingle();
  const org = (orgRow ?? {}) as {
    name?: string | null;
    brand_color?: string | null;
    brand_color_secondary?: string | null;
    logo_url?: string | null;
  };

  return {
    signedUrl: signed.signedUrl,
    title: doc.title,
    docType: doc.doc_type,
    mimeType: doc.mime_type,
    sizeBytes: doc.size_bytes,
    orgName: org.name ?? "Vacantless",
    brandColor: org.brand_color ?? null,
    brandColorSecondary: org.brand_color_secondary ?? null,
    logoUrl: org.logo_url ?? null,
  };
}

export default async function SharedDocumentPage({
  params,
}: {
  params: { token: string };
}) {
  const info = await resolveShare(params.token);
  if (!info) notFound();

  const brand = accessibleBrand(info.brandColor || "#4f46e5");
  const brandBg = brandGradientCss(info.brandColor, info.brandColorSecondary);
  const isImage = info.mimeType.startsWith("image/");

  return (
    <div
      className="flex min-h-screen flex-col bg-gray-50"
      style={{ ["--brand-color" as string]: brand }}
    >
      <header className="relative text-white shadow-md" style={{ background: brandBg }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-5">
          {info.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.logoUrl} alt={info.orgName} className="h-8" />
          ) : (
            <p className="text-lg font-bold">{info.orgName}</p>
          )}
          <a
            href={info.signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
          >
            Download
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">{info.title}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {documentTypeLabel(info.docType)} · {formatBytes(info.sizeBytes)} ·
            shared by {info.orgName}
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.signedUrl} alt={info.title} className="mx-auto block max-h-[80vh] w-auto" />
          ) : (
            <iframe
              src={info.signedUrl}
              title={info.title}
              className="h-[80vh] w-full"
            />
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          This is a private, read-only link. If it stops working, ask {info.orgName}{" "}
          for a new one.
        </p>
      </main>
    </div>
  );
}
