// S839c (REVIEW-S839 finding 6): pages asked the database one question at a
// time. early() starts a question now so several run together; the page still
// awaits each one where it uses the answer, so the order of the page's logic
// does not change. A Supabase query only runs when something awaits it, so
// wrapping it here is what starts it. The empty catch only stops Node from
// treating a failure as unhandled before the page reaches its await; the
// await still throws the same error.
export function early<T>(work: PromiseLike<T>): Promise<T> {
  const started = Promise.resolve(work);
  started.catch(() => {});
  return started;
}
