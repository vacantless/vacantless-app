// S824d: copy a value that is still being made, then open a link, in one tap.
// iPhone Safari only lets a page write the clipboard inside the tap itself; a
// ClipboardItem given a promise keeps that permission while the server makes
// the key. Older browsers fall back to writeText after the key arrives.
// Browser only (no server imports).

export async function copyWhenReady(value: Promise<string | null>): Promise<boolean> {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const CI = typeof window !== "undefined" ? (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem : undefined;
  if (nav?.clipboard && "write" in nav.clipboard && CI) {
    try {
      const blob = value.then((v) => {
        if (!v) throw new Error("no value");
        return new Blob([v], { type: "text/plain" });
      });
      await nav.clipboard.write([new CI({ "text/plain": blob })]);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    const v = await value;
    if (!v || !nav?.clipboard) return false;
    await nav.clipboard.writeText(v);
    return true;
  } catch {
    return false;
  }
}
