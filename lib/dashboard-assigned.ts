export type AssignedView = "mine" | "team";

/** Effective view: unlinked members can only see Team; linked members default
 * to Mine unless they asked for Team. */
export function resolveAssignedView(args: {
  hasLinkedAgent: boolean;
  param: string | string[] | undefined;
}): AssignedView {
  if (!args.hasLinkedAgent) return "team";
  const p = Array.isArray(args.param) ? args.param[0] : args.param;
  return p === "team" ? "team" : "mine";
}
