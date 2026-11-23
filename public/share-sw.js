// S833d: Android "Share to Vacantless" sends the picture straight to the
// server, and Vercel refuses a request over about 4.5 MB (413, KI1746). This
// worker catches only that one share and shrinks a big picture on the phone
// first. Every other request goes to the network untouched.
const SHARE_PATH = "/dashboard/replies/shared";
const FIELD = "screenshot";
const SHRINK_OVER_BYTES = 1500000;
const MAX_SIDE = 2000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function shrink(file) {
  try {
    if (!file || file.size <= SHRINK_OVER_BYTES || typeof OffscreenCanvas === "undefined") return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    let blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    if (blob.size > 3500000) blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.6 });
    return new File([blob], "screenshot.jpg", { type: "image/jpeg" });
  } catch (e) {
    return file;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "POST") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname !== SHARE_PATH) return;
  event.respondWith(
    (async () => {
      try {
        const form = await req.clone().formData();
        const file = form.get(FIELD);
        const out = new FormData();
        if (file instanceof File) out.append(FIELD, await shrink(file));
        return await fetch(SHARE_PATH, { method: "POST", body: out, credentials: "include", redirect: "manual" });
      } catch (e) {
        return fetch(req);
      }
    })(),
  );
});
