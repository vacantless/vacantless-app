// S758: open to every account (lib/post-lease-surface TENANCY_SECTIONS). The
// LTB forms and the Standard Lease live here, and a new account starts its
// first tenancy here. Money, Rent, Expenses and Repairs keep the S710 wall.
export const dynamic = "force-dynamic";

export default function TenancySectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
