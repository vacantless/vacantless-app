// S700 (dress rehearsal F3): "Open checklist" looked dead on the first click
// because this page renders on the server with no feedback, so the customer
// clicked again. Show something the instant the link is pressed.
export default function GettingStartedLoading() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse space-y-4" aria-busy="true">
      <p className="text-sm font-medium text-gray-600">Opening your checklist...</p>
      <div className="h-24 rounded-xl border border-gray-200 bg-white" />
      <div className="h-24 rounded-xl border border-gray-200 bg-white" />
    </div>
  );
}
