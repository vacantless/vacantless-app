// ============================================================================
// Co-pilot RESERVATIONS vs operator-visible posts (S681).
//
// A "reserved plumbing" listing_posts row is the co-pilot's PRE-POST
// reservation: status 'draft', no url, and referenced by a
// distribution_run_items row. The standing attribution rule is to reserve the
// row FIRST so the tracked ?p= link can be built from its id, and only then
// post. That rule manufactures these rows on purpose.
//
// The where-posted tracker HIDES them (the ready ?p= link is shown in the
// co-pilot panel instead), so an operator can never see one and never remove
// one. Anything that counts "how many posts does this property have?" in order
// to decide what the OPERATOR may do must therefore ask the same question the
// renderer asks. When the two drift, the UI offers no way out.
//
// That drift WAS the S681 defect: deleteProperty counted reservations, so every
// property that ever entered the co-pilot and did not finish a post became
// permanently undeletable, with no control anywhere to clear the blocker.
//
// NOTE THE BOUNDARY. This is not a licence to filter listing-post counts
// generally. hardDeletable treats a REAL tracked post as a deletion SAFETY
// guard and that must keep biting. Only the reserved-plumbing set is excluded,
// and only because the operator has no control over it.
//
// Pure functions only. The DB round trip is injected by the caller so both
// call sites share one definition of the rule without this file importing a
// Supabase client.
// ============================================================================

export type ReservationCandidate = {
  id: string;
  status: string | null;
  url: string | null;
};

/** A url-less draft: the shape a reservation has before anything is posted. */
export function isUnpostedDraft(post: ReservationCandidate): boolean {
  return post.status === "draft" && !(post.url && post.url.trim());
}

/**
 * The reserved-plumbing set: url-less drafts that a run item references.
 *
 * A hand-created url-less draft that NO run item references is operator-made,
 * still renders in the tracker with its Remove control, and is deliberately
 * NOT in this set.
 */
export function reservedListingPostIds(
  posts: readonly ReservationCandidate[],
  runItemPostIds: Iterable<string | null>,
): Set<string> {
  const referenced = new Set<string>();
  for (const id of runItemPostIds) {
    if (id) referenced.add(id);
  }
  const reserved = new Set<string>();
  for (const post of posts) {
    if (isUnpostedDraft(post) && referenced.has(post.id)) {
      reserved.add(post.id);
    }
  }
  return reserved;
}

/** How many posts the operator can actually see and act on. */
export function visibleListingPostCount(
  posts: readonly ReservationCandidate[],
  reserved: ReadonlySet<string>,
): number {
  return posts.reduce(
    (total, post) => (reserved.has(post.id) ? total : total + 1),
    0,
  );
}

/**
 * Resolve the reserved set, skipping the round trip when there is no url-less
 * draft to ask about. `fetchRunItemPostIds` receives only those draft ids and
 * returns the listing_post_id of every run item referencing them.
 */
export async function loadReservedListingPostIds(
  posts: readonly ReservationCandidate[],
  fetchRunItemPostIds: (draftIds: string[]) => Promise<(string | null)[]>,
): Promise<Set<string>> {
  const draftIds = posts.filter(isUnpostedDraft).map((post) => post.id);
  if (draftIds.length === 0) return new Set<string>();
  return reservedListingPostIds(posts, await fetchRunItemPostIds(draftIds));
}
