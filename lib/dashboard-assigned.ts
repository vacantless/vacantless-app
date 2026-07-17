export type AssignedView = "mine" | "team";

/** Effective view. Unlinked members can only see Team. An explicit param wins.
 * With no param, use the member's saved default, else Mine. */
export function resolveAssignedView(args: {
  hasLinkedAgent: boolean;
  param: string | string[] | undefined;
  preferred?: AssignedView | null;
}): AssignedView {
  if (!args.hasLinkedAgent) return "team";
  const p = Array.isArray(args.param) ? args.param[0] : args.param;
  if (p === "team") return "team";
  if (p === "mine") return "mine";
  return args.preferred === "team" ? "team" : "mine";
}
