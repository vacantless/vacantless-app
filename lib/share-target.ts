// S821b: Android "Share to Vacantless". The installed app shows in Android's
// Share menu (app/manifest.ts share_target). A shared chat screenshot posts to
// SHARE_TARGET_PATH with the landlord's own sign-in, so there is no Shortcut
// and no key to set up. This file is the pure half: the words and the page.

export const SHARE_TARGET_PATH = "/dashboard/replies/shared";
export const SHARE_TARGET_FIELD = "screenshot";
export const SHARE_PAGE_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } as const;
export const ANDROID_SHARE_NOTE = "Sent from the Android share menu (chat screenshot).";

/** The three steps shown on Quick replies. Short sentences: many readers use a translator. */
export const ANDROID_SHARE_STEPS = [
  "Open this page in Chrome on your Android phone.",
  "Tap the green button \"Install Vacantless on this phone\" below. No button? Tap the three dots at the top, then \"Add to Home screen\", then \"Install\".",
  "Take a screenshot of the chat. Tap Share, then tap Vacantless.",
] as const;

/**
 * S833b: the "Install Vacantless" button on Quick replies. Android Chrome fires
 * beforeinstallprompt when the site can be installed; the button opens Chrome's
 * own install screen, so nobody has to find the three-dots menu.
 */
export type InstallState = "installed" | "ready" | "none";

export function installState(input: { android: boolean; standalone: boolean; promptReady: boolean }): InstallState {
  // An iPhone home-screen app has no Share menu entry, so never tell it so.
  if (!input.android) return "none";
  if (input.standalone) return "installed";
  return input.promptReady ? "ready" : "none";
}

export const INSTALL_BUTTON_LABEL = "Install Vacantless on this phone";
export const INSTALLED_LINE = "Vacantless is installed on this phone. It is in your Share menu.";

/** S833f: the share screen ends with a Done button that closes it. */
export const SHARE_DONE_LABEL = "Done";
export const SHARE_COPIED_LINE = "Copied. Tap Done, then paste it in the chat.";

/** True when the line says the renter is in Renters now (saved, or already there). */
export function shareSaved(line: string): boolean {
  return /^Saved /.test(line) || / is already in Renters/.test(line);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The page the landlord sees after sharing. Plain HTML with its own styles, so
 * it loads fast on a phone and a browser translator can read every word.
 */
export function renderSharePage(input: { line: string; reply: string | null; link: string | null; ok: boolean }): string {
  const lines = input.line.split("\n").filter((l) => l.trim());
  const reply = input.reply?.trim() || null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Vacantless</title>
<style>
body{margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;font-size:17px;line-height:1.5}
main{max-width:520px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:20px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 8px}
p{margin:0 0 8px}
pre{white-space:pre-wrap;word-break:break-word;font:inherit;background:#f4f4f5;border-radius:8px;padding:12px;margin:8px 0 12px}
a.btn,button{display:block;width:100%;box-sizing:border-box;text-align:center;border-radius:10px;padding:14px;font-size:17px;font-weight:600;text-decoration:none;border:0;margin-top:8px}
.primary{background:#176044;color:#fff}
.plain{background:#fff;color:#176044;border:1px solid #d4d4d8 !important}
</style>
</head>
<body>
<main>
<div class="card">
<h1>${input.ok ? "Saved" : "Not saved"}</h1>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
</div>
${
  reply
    ? `<div class="card">
<h1>Your reply</h1>
<pre id="reply">${escapeHtml(reply)}</pre>
<button class="primary" id="copy" type="button">Copy reply</button>
<p id="copied" style="display:none;margin-top:8px">${SHARE_COPIED_LINE}</p>
</div>`
    : ""
}
${input.link ? `<a class="btn plain" href="${escapeHtml(input.link)}">Open this renter</a>` : ""}
<a class="btn plain" href="/dashboard/replies">Open Quick replies</a>
<button class="primary" id="done" type="button">${SHARE_DONE_LABEL}</button>
</main>
<script>
${
  reply
    ? `document.getElementById("copy").addEventListener("click", function () {
  var t = document.getElementById("reply").textContent || "";
  function done() { document.getElementById("copied").style.display = "block"; }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () {});
});`
    : ""
}
// S833f: Done closes this screen and goes back to the chat. If the phone keeps
// it open, it goes to the app's home so the next share starts clean.
document.getElementById("done").addEventListener("click", function () {
  try { window.close(); } catch (e) {}
  setTimeout(function () { location.replace("/dashboard"); }, 300);
});
</script>
</body>
</html>`;
}
