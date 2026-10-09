import Link from "next/link";

export const metadata = {
  title: "Account closed - Vacantless",
};

// S702: where a landlord lands after closing their account from Settings.
export default function AccountClosedPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-gray-800">
      <h1 className="text-2xl font-semibold">Your account is closed</h1>
      <p className="mt-4">
        Your rentals are off the market and nobody can sign in to the account.
        We will delete your stored data within 30 days.
      </p>
      <p className="mt-4">
        Changed your mind? Email{" "}
        <a href="mailto:hello@vacantless.com" className="font-medium underline">
          hello@vacantless.com
        </a>{" "}
        before then and we can restore it.
      </p>
      <p className="mt-8">
        <Link href="/" className="font-medium underline">
          Back to Vacantless
        </Link>
      </p>
    </main>
  );
}
