"use client";

import { useRef, useState } from "react";
import { submitSignature } from "./actions";

// Tenant signature capture (lease vault #11, slice 4). Type OR draw a signature,
// give ECA-2000 consent, submit. The hidden inputs are controlled by React state
// so whatever is captured (typed string or drawn PNG data URL) is exactly what
// posts to the server action. Pure client interaction; the server action +
// SECURITY DEFINER RPC re-validate everything.

export function SignatureForm({
  token,
  brand,
}: {
  token: string;
  brand: string;
}) {
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [signedName, setSignedName] = useState("");
  const [typedSig, setTypedSig] = useState("");
  const [drawnData, setDrawnData] = useState("");
  const [consent, setConsent] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  // The value that actually posts: typed name string, or the canvas PNG.
  const signatureData = mode === "typed" ? typedSig : drawnData;
  const ready =
    signedName.trim().length > 0 &&
    consent &&
    (mode === "typed" ? typedSig.trim().length > 0 : hasDrawn);

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return;
    drawing.current = true;
    const ctx = c.getContext("2d")!;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    c.setPointerCapture(e.pointerId);
  }

  function moveDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    const { x, y } = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endDraw() {
    if (!drawing.current) return;
    drawing.current = false;
    const c = canvasRef.current;
    if (c) {
      setDrawnData(c.toDataURL("image/png"));
      setHasDrawn(true);
    }
  }

  function clearCanvas() {
    const c = canvasRef.current;
    if (c) {
      c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    }
    setDrawnData("");
    setHasDrawn(false);
  }

  const tabBase =
    "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition border";
  return (
    <form action={submitSignature} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="signature_kind" value={mode} />
      <input type="hidden" name="signature_data" value={signatureData} />

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Your full legal name
        </label>
        <input
          name="signed_name"
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          placeholder="e.g. Dana Tenant"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          autoComplete="name"
        />
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-gray-700">Your signature</p>
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("typed")}
            className={tabBase}
            style={
              mode === "typed"
                ? { background: brand, color: "#fff", borderColor: brand }
                : { background: "#fff", color: "#374151", borderColor: "#d1d5db" }
            }
          >
            Type it
          </button>
          <button
            type="button"
            onClick={() => setMode("drawn")}
            className={tabBase}
            style={
              mode === "drawn"
                ? { background: brand, color: "#fff", borderColor: brand }
                : { background: "#fff", color: "#374151", borderColor: "#d1d5db" }
            }
          >
            Draw it
          </button>
        </div>

        {mode === "typed" ? (
          <>
            <input
              value={typedSig}
              onChange={(e) => setTypedSig(e.target.value)}
              placeholder="Type your name as your signature"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
              style={{ fontFamily: "'Brush Script MT', cursive", fontSize: "22px" }}
            />
            <p className="mt-1 text-xs text-gray-400">
              Typing your name here is your electronic signature.
            </p>
          </>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              width={600}
              height={180}
              onPointerDown={startDraw}
              onPointerMove={moveDraw}
              onPointerUp={endDraw}
              onPointerLeave={endDraw}
              className="w-full touch-none rounded-lg border border-gray-300 bg-white"
              style={{ height: "180px" }}
            />
            <div className="mt-1 flex items-center justify-between">
              <p className="text-xs text-gray-400">Draw your signature above.</p>
              <button
                type="button"
                onClick={clearCanvas}
                className="text-xs font-medium text-gray-500 underline"
              >
                Clear
              </button>
            </div>
          </>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          I agree to sign this lease electronically and consent to the use of an
          electronic signature, which is legally binding under Ontario's
          Electronic Commerce Act, 2000.
        </span>
      </label>

      <button
        type="submit"
        disabled={!ready}
        className="w-full rounded-lg px-4 py-2.5 font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: brand }}
      >
        Sign &amp; submit
      </button>
    </form>
  );
}
