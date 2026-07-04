// Copy text to the clipboard with a graceful fallback.
//
// The async Clipboard API (navigator.clipboard.writeText) is the modern path,
// but it silently rejects in a handful of real cases our operators hit: an
// older Safari, a document that isn't focused, a denied clipboard permission,
// or a non-secure context. When it does, we fall back to the legacy
// document.execCommand("copy") off a temporary off-screen <textarea>, which
// still works in those environments. Only if BOTH paths fail do we return
// false, so the caller can surface a "select and copy" hint next to the
// already-selectable field.
//
// Returns true when the text was copied by either path, false otherwise.
// SSR-safe: with no navigator and no document it just returns false.

export type ClipboardDeps = {
  // Async Clipboard API writer. Defaults to navigator.clipboard.writeText.
  writeText?: (text: string) => Promise<void>;
  // Legacy synchronous copy. Defaults to the execCommand-textarea path.
  legacyCopy?: (text: string) => boolean;
};

// Default legacy path: stage the text in an off-screen readonly textarea,
// select it, and ask the document to copy. Returns false (never throws) when
// there's no document or the command is unavailable/blocked.
export function legacyExecCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // Keep it out of view and non-interactive, but still selectable.
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function defaultWriteText(): ((text: string) => Promise<void>) | undefined {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    return navigator.clipboard.writeText.bind(navigator.clipboard);
  }
  return undefined;
}

export async function copyToClipboard(
  text: string,
  deps?: ClipboardDeps,
): Promise<boolean> {
  const writeText = deps?.writeText ?? defaultWriteText();
  if (writeText) {
    try {
      await writeText(text);
      return true;
    } catch {
      // Clipboard API rejected (blocked / unfocused / insecure) - fall through.
    }
  }

  const legacyCopy = deps?.legacyCopy ?? legacyExecCopy;
  try {
    return legacyCopy(text);
  } catch {
    return false;
  }
}
