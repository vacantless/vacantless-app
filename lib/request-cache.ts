import * as React from "react";

// S839c (REVIEW-S839 finding 5): one page view asked "who is signed in" and
// "which account" four or five times, each a network trip. perRequest() makes
// a no-argument or simple-argument lookup run once per page render and reuse
// the answer. It uses React's cache(), which only remembers inside one server
// render: a server action or a route handler still gets a fresh answer every
// call, so a save never sees a stale account. Where cache() does not exist
// (the plain test runner) the function is returned as is.
export function perRequest<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const cache = (React as unknown as { cache?: <F>(f: F) => F }).cache;
  return typeof cache === "function" ? cache(fn) : fn;
}
