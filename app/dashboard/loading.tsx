// S839a (REVIEW-S839 finding 3): a tap on any dashboard link showed nothing
// until the whole next page was ready (0.5 to 4 seconds), so it looked
// ignored. This shows at once inside the header while the page loads.
// Getting started keeps its own (app/dashboard/(wizard)/getting-started/loading.tsx).
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-live="polite">
      <p className="text-sm font-medium text-gray-600">Loading...</p>
      <div className="h-10 w-2/3 max-w-sm rounded-lg bg-gray-200" />
      <div className="h-24 rounded-xl border border-gray-200 bg-white" />
      <div className="h-24 rounded-xl border border-gray-200 bg-white" />
      <div className="h-24 rounded-xl border border-gray-200 bg-white" />
    </div>
  );
}
