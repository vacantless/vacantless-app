// ============================================================================
// QR -> inline SVG. The IMPURE half of the listing-marketing kit (S388, Tier A):
// turns the public /r landing link into a scannable SVG with no raster file, no
// storage, and no external network call (the `qrcode` package encodes locally).
// Kept tiny and isolated so lib/listing-marketing stays pure + unit-tested.
// ============================================================================

import QRCode from "qrcode";

// Render `text` as a standalone SVG string (caller embeds it). Returns null on
// any failure so a kit surface degrades gracefully (link still copyable) rather
// than throwing during a server render.
export async function qrSvg(
  text: string,
  opts?: { width?: number },
): Promise<string | null> {
  const value = (text ?? "").trim();
  if (!value) return null;
  try {
    return await QRCode.toString(value, {
      type: "svg",
      margin: 1,
      width: opts?.width ?? 180,
      errorCorrectionLevel: "M",
    });
  } catch {
    return null;
  }
}
