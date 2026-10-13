// Single switch for every screening claim the product makes (S712 honest claims).
//
// Credit and background screening (lib/rental-screening/*, SingleKey) is built
// but NOT wired: nothing in app/ calls it yet. Until it is, every surface that
// promises screening reads this constant and hides the promise:
//   - lead detail: the "who pays for screening" picker, the "coming next" line
//     and the Free-plan upsell wording;
//   - the public /apply/[token] form: the screening-partner note and the
//     credit report / background check authorization;
//   - the /apply submit action: it no longer asks for that authorization.
//
// Flip to true in the same change that wires SingleKey into the apply flow.
export const SCREENING_LIVE: boolean = false;
