export function hardDeletable(
  status: string,
  leadCount: number,
  tenancyCount: number,
  postCount: number,
): boolean {
  return (
    (status === "draft" || status === "off_market") &&
    leadCount === 0 &&
    tenancyCount === 0 &&
    postCount === 0
  );
}
