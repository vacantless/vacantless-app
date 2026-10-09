"use client";

// S702: make a 15-second video ad from this rental's photos, in the browser.
// Nothing is uploaded: the video is drawn on a canvas, recorded, and saved to
// the landlord's device to post on Facebook, Instagram or TikTok.
import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import {
  VIDEO_FPS,
  VIDEO_H,
  VIDEO_MS,
  VIDEO_W,
  buildVideoAdPlan,
  frameAt,
  pickVideoType,
  videoFilename,
  zoomAt,
  type VideoAdPlan,
} from "@/lib/video-ad";
import { videoAdHook } from "./video-ad-actions";

type Props = {
  propertyId: string;
  photoUrls: string[];
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  address: string;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("photo"));
    img.src = url;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, zoom: number, alpha: number) {
  const scale = Math.max(VIDEO_W / img.width, VIDEO_H / img.height) * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (VIDEO_W - w) / 2, (VIDEO_H - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

function drawText(ctx: CanvasRenderingContext2D, plan: VideoAdPlan, tMs: number) {
  // Dark bands so white text reads on any photo.
  const top = ctx.createLinearGradient(0, 0, 0, 360);
  top.addColorStop(0, "rgba(0,0,0,0.65)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, VIDEO_W, 360);
  const bottom = ctx.createLinearGradient(0, VIDEO_H - 520, 0, VIDEO_H);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(1, "rgba(0,0,0,0.8)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, VIDEO_H - 520, VIDEO_W, 520);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.fillText(plan.top, VIDEO_W / 2, 90);
  ctx.font = "800 58px system-ui, sans-serif";
  ctx.fillText(plan.hook, VIDEO_W / 2, 170, VIDEO_W - 60);

  let y = VIDEO_H - 330;
  if (plan.price) {
    ctx.font = "800 76px system-ui, sans-serif";
    ctx.fillText(plan.price, VIDEO_W / 2, y);
    y += 70;
  }
  if (plan.details) {
    ctx.font = "600 42px system-ui, sans-serif";
    ctx.fillText(plan.details, VIDEO_W / 2, y);
    y += 56;
  }
  ctx.font = "500 32px system-ui, sans-serif";
  ctx.fillText(plan.address, VIDEO_W / 2, y, VIDEO_W - 60);
  // The call to action shows in the last 5 seconds.
  if (tMs > VIDEO_MS - 5000) {
    ctx.font = "700 34px system-ui, sans-serif";
    ctx.fillText(plan.cta, VIDEO_W / 2, VIDEO_H - 60, VIDEO_W - 40);
  }
}

export function VideoAdCard(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"idle" | "making" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => () => {
    if (download) URL.revokeObjectURL(download.url);
  }, [download]);

  async function make() {
    setState("making");
    setMessage(null);
    try {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || typeof MediaRecorder === "undefined") throw new Error("browser");
      const mime = pickVideoType((t) => MediaRecorder.isTypeSupported(t));
      if (!mime) throw new Error("browser");

      const hook = await videoAdHook(props.propertyId);
      const plan = buildVideoAdPlan({ ...props, hook });
      if (!plan) throw new Error("photos");
      const images = await Promise.all(plan.photos.map(loadImage));

      const stream = canvas.captureStream(VIDEO_FPS);
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

      const draw = (t: number) => {
        const f = frameAt(plan, t);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
        drawCover(ctx, images[f.index], zoomAt(f.progress), 1);
        if (f.fadeNext > 0) drawCover(ctx, images[f.index + 1], zoomAt(0), f.fadeNext);
        drawText(ctx, plan, t);
      };
      draw(0); // throws here if a photo cannot be drawn
      ctx.getImageData(0, 0, 1, 1);

      recorder.start(250);
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const t = performance.now() - t0;
          draw(Math.min(t, VIDEO_MS));
          if (t >= VIDEO_MS) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      recorder.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      if (download) URL.revokeObjectURL(download.url);
      setDownload({ url: URL.createObjectURL(blob), name: videoFilename(props.address, mime) });
      setState("done");
    } catch (err) {
      const why = err instanceof Error ? err.message : "";
      setMessage(
        why === "browser"
          ? "This browser cannot make videos. Try Chrome on a computer."
          : "We could not use the photos. Try again in a minute.",
      );
      setState("error");
    }
  }

  return (
    <Card className="mt-5">
      <h3 className="text-lg font-bold text-[var(--vl-text-primary)]">Video ad from your photos</h3>
      <p className="mt-1 text-base text-[var(--vl-text-secondary)]">
        Make a 15-second video from your photos. Post it on Facebook, Instagram or TikTok. Videos reach more renters than photos.
      </p>
      <div className="mt-4 flex flex-wrap items-start gap-4">
        <canvas
          ref={canvasRef}
          width={VIDEO_W}
          height={VIDEO_H}
          className="w-40 rounded-xl border border-gray-200 bg-black"
          aria-label="Video ad preview"
        />
        <div className="space-y-3">
          <Button type="button" onClick={make} disabled={state === "making"}>
            {state === "making" ? "Making your video. It takes 15 seconds." : state === "done" ? "Make it again" : "Make the video"}
          </Button>
          {download && (
            <p>
              <a
                href={download.url}
                download={download.name}
                className="font-semibold text-brand underline"
              >
                Save the video
              </a>
            </p>
          )}
          {message && (
            <p className="text-sm font-medium text-red-700" role="alert">
              {message}
            </p>
          )}
          <p className="text-sm text-[var(--vl-text-muted)]">Keep this tab open while it records.</p>
        </div>
      </div>
    </Card>
  );
}
