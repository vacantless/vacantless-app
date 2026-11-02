// S742b: the parts of the public-form limits a browser may import (no node
// modules here; the form at /r/<id> is a client component).

/** Hidden field name. Real browsers leave it empty; many bots fill every box. */
export const HONEYPOT_FIELD = "company_website";

/** True when the hidden field carries text: not a person. Pure. */
export function honeypotTripped(get: (name: string) => unknown): boolean {
  const v = get(HONEYPOT_FIELD);
  return typeof v === "string" && v.trim().length > 0;
}
