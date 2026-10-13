import { requirePostLeaseSurface } from "@/lib/post-lease-surface";

// S710 leasing-only wall: closes this post-lease section to URL access too.
export const dynamic = "force-dynamic";

export default async function PostLeaseSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePostLeaseSurface();
  return <>{children}</>;
}
