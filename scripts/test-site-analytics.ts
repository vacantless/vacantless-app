// S784: only marketing pages reach analytics; only utm_ query tags survive.
import assert from "node:assert/strict";
import { keepAnalyticsUrl } from "../lib/site-analytics-url";

assert.equal(keepAnalyticsUrl("https://www.vacantless.com/"), "https://www.vacantless.com/");
assert.equal(
  keepAnalyticsUrl("https://www.vacantless.com/ask/when-can-i-give-an-n4?utm_source=youtube&utm_campaign=ask-n4&ref=abc"),
  "https://www.vacantless.com/ask/when-can-i-give-an-n4?utm_source=youtube&utm_campaign=ask-n4",
);
assert.equal(keepAnalyticsUrl("https://www.vacantless.com/tools/n4?email=a@b.c"), "https://www.vacantless.com/tools/n4");
assert.equal(keepAnalyticsUrl("https://www.vacantless.com/r/some-rental"), null);
assert.equal(keepAnalyticsUrl("https://www.vacantless.com/showing/tok123"), null);
assert.equal(keepAnalyticsUrl("https://app.vacantless.com/dashboard"), null);
assert.equal(keepAnalyticsUrl("not a url"), null);
console.log("site-analytics: ok");
