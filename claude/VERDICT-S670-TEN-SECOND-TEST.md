# The 10-second test: could a landlord run this from an iPad?

Measured on 50 Glenrose Ave Unit 4 (Abbas Husain), 2026-08-21, read-only.
Reframed per Noam: not "does it fit on mobile", but "is a desktop unnecessary".

## Method

Extracted **every string actually above the fold** on the property page before any
scroll, at a 969px viewport height. That is generous: an iPad landscape. A phone is
nearer 700px, so a phone sees **less** than this list.

## What the landlord sees before scrolling

```
50 Glenrose Ave, Unit 4, Toronto, ON M4T 1K4
Live          $2,150/mo          [ Duplicate this property ]
Vacancy cost - Vacancy start unknown
  Tracked from when you mark a rental available. Older available rentals keep
  an unknown start instead of a guessed vacancy date.
Where this rental is                                    2 of 7 done
  Unit details  Details added
  Market        Live · 11 photos · 2 posts
  3 Inquiries   No inquiries yet
  4 Viewings    Set viewing times to enable booking
  5 Screen      No applications yet
  6 Lease       No lease yet
  7 Tenanted    Not tenanted yet
Current step: Inquiries - no inquiries yet.
Market this property
  Your property is live. Use the distribution checklist to post where re…  [cut off]
```

The tab bar containing **Get online** begins at **y = 1055px**. It is not on this
screen at any device size.

## The four questions

### 1. Is this listing online? — **Answered, and answered WRONG**

The landlord sees a green **`Live`** chip and **`Live · 11 photos · 2 posts`**. They
will conclude the unit is online and advertised on two sites.

**Both of Glenrose Unit 4's ads are expired.** Zero live external listings.

This is the worst of the four outcomes. A page that says nothing leaves the landlord
to go looking. A page that says "2 posts" in confident green ends the enquiry. They
close the iPad believing the unit is being marketed, and it is not. This is the same
failure that left a dead Facebook ad reading `live` for 46 days, surfaced in a
different component.

*Fixed by the attached patch:* the rail now reads `Live · 11 photos · no live ads`,
and the syndication headline reads `Your renter page is live. No outside sites are
live yet.`

### 2. What is the one next thing to tap? — **No**

The visually dominant control above the fold is **`Duplicate this property`**. It is
a rare, near-destructive action and it is the most tappable thing on the screen.

The real next action is the sentence `Market this property / Your property is live.
Use the distribution checklist…`, which sits at the very bottom edge and is **cut off
mid-word**. Its CTA is below the fold.

A landlord scanning for ten seconds will either tap Duplicate or scroll blindly.

### 3. What still needs my sign-in or proof? — **No**

**Nothing about sign-in, payment, approval or proof appears above the fold at all.**
Every one of those signals lives inside Get online, past 1055px. On a phone that is
roughly two full screens of scrolling before the landlord learns that anything is
waiting on them.

This is the question the product is uniquely good at answering and it is the one
buried deepest.

### 4. Can I avoid the copy/photo/QR tooling unless I ask? — **Yes**

This one genuinely passes, and it is the branch's real achievement. Photos collapse
once they exist (verified live: 11 photos, the `<details>` reads `open: false`).
Listing copy and the marketing kit are both disclosures. The asset binder no longer
competes for the first scroll.

## Verdict

**A desktop is still necessary, and layout is not the reason.**

The page does not overflow. Nothing is clipped at iPad width. Question 4 is solved.
The failure is **ordering, not responsiveness**: the first screen is about *lifecycle
stage*, and the landlord's question is *am I online and what do I tap*. Those are
different questions, and the page answers the one nobody asked.

Everything needed is on this page, correct and well built. It is all sitting under a
full screen of scaffolding: a duplicate button, a vacancy-cost explainer, and a
seven-step rail of which five steps are "not yet".

**This reframing changes the priority of H-1.** It was deferred as "layout hierarchy,
separate pass". Under the ten-second test it is not layout polish, it is the review.
Fixing B-1 stops the page lying; only H-1 makes it *useful* in ten seconds.

## What would pass the test

Above the fold, in this order:

1. **One status line that separates the two facts.** "Renter page live · 0 outside sites live." Never one blended number.
2. **One primary action**, sized like the primary action. Today that slot is held by Duplicate.
3. **The waiting-on-you count**, if any. "2 need your sign-in" is the single most valuable string this product can show a landlord, and it is currently two screens down.
4. Everything else — vacancy cost, the seven-step rail, the asset binder — below that line or behind a disclosure.

The rail is the clearest candidate to demote. It occupies the most space above the
fold and, for a Live unit being marketed, tells the landlord the least.
