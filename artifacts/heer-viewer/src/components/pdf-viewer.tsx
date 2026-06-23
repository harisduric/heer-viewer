import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { useGesture } from "@use-gesture/react";
import { Loader2, AlertCircle } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// Module-level constant so the default overlays prop is always the same reference.
// This prevents PdfViewer's render effect from re-running when the caller
// omits overlays (each function call would otherwise produce a new [] object).
const EMPTY_OVERLAYS: {
  x: number;
  y: number;
  label: string;
  value: string;
  rotation?: number;
  textWidth?: number;
}[] = [];

interface PdfViewerProps {
  url?: string;
  blob?: Blob;
  pageNumber?: number;
  scale?: number;
  /** When provided (and no crop), scale is computed as fitToWidth / nativePageWidth
   *  so the canvas exactly fills this width regardless of the PDF page's native size.
   *  Takes priority over the scale prop. */
  fitToWidth?: number;
  crop?: { cropX: number; cropY: number; cropW: number; cropH: number } | null;
  overlays?: { x: number; y: number; label: string; value: string; rotation?: number; textWidth?: number }[];
  interactive?: boolean;
  onRendered?: (dataUrl: string) => void;
  /** Fires once after each render with the actual canvas pixel dimensions.
   *  Stored in a ref inside PdfViewer — safe to pass an unstable closure. */
  onDimensions?: (dims: { widthPx: number; heightPx: number }) => void;
}

export function PdfViewer({
  url,
  blob,
  pageNumber = 1,
  scale = 1,
  fitToWidth,
  crop,
  overlays = EMPTY_OVERLAYS,
  interactive = false,
  onRendered,
  onDimensions,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to onDimensions so it can be an unstable closure in the caller
  // without triggering the render effect.
  const onDimensionsRef = useRef(onDimensions);
  useEffect(() => { onDimensionsRef.current = onDimensions; }, [onDimensions]);

  const [zoom, setZoom] = useState(scale);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Sync external scale prop into zoom (e.g. when container resizes).
  // Skip sync when fitToWidth is active — renderZoom is computed from the page
  // viewport, not from the scale prop.
  useEffect(() => {
    if (fitToWidth == null) setZoom(scale);
  }, [scale, fitToWidth]);

  useGesture(
    {
      onDrag: ({ offset: [x, y] }) => {
        if (interactive) setPan({ x, y });
      },
      onPinch: ({ offset: [d] }) => {
        if (interactive) setZoom(Math.max(0.5, Math.min(5, d)));
      },
      onWheel: ({ delta: [, y] }) => {
        if (interactive) setZoom((z) => Math.max(0.5, Math.min(5, z - y * 0.01)));
      },
    },
    { target: containerRef, eventOptions: { passive: false } }
  );

  const resetView = () => {
    setZoom(scale);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    let active = true;
    setError(null);
    setLoading(true);

    const renderPdf = async () => {
      if (!url && !blob) {
        if (active) setLoading(false);
        return;
      }
      try {
        let pdfData: Uint8Array;
        if (blob) {
          pdfData = new Uint8Array(await blob.arrayBuffer());
        } else {
          const res = await fetch(url!);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          pdfData = new Uint8Array(await res.arrayBuffer());
        }

        if (!active) return;

        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        const page = await pdf.getPage(pageNumber);

        // viewport at scale=1 gives native page dimensions in CSS pixels (= PDF pts).
        // Used for yAdjust correction and to compute fitToWidth scale.
        const viewport1 = page.getViewport({ scale: 1 });

        // renderZoom: when fitToWidth is provided (no crop), derive scale from the
        // page's actual native width so the canvas fills exactly fitToWidth pixels
        // regardless of the PDF page dimensions (avoids assuming 595pt / A4 portrait).
        const renderZoom = (fitToWidth != null && !crop)
          ? fitToWidth / viewport1.width
          : zoom;

        const viewport = page.getViewport({ scale: renderZoom });

        const pdfCanvas = pdfCanvasRef.current;
        const overlayCanvas = overlayCanvasRef.current;
        if (!pdfCanvas || !overlayCanvas || !active) return;

        const context = pdfCanvas.getContext("2d")!;
        const overlayContext = overlayCanvas.getContext("2d")!;

        let offsetX = 0;
        let offsetY = 0;

        if (crop) {
          pdfCanvas.width = Math.round(crop.cropW * renderZoom);
          pdfCanvas.height = Math.round(crop.cropH * renderZoom);
          offsetX = -crop.cropX * renderZoom;
          offsetY = -crop.cropY * renderZoom;
        } else {
          pdfCanvas.width = Math.round(viewport.width);
          pdfCanvas.height = Math.round(viewport.height);
        }
        overlayCanvas.width = pdfCanvas.width;
        overlayCanvas.height = pdfCanvas.height;

        // Report actual canvas pixel dimensions to the parent (stable ref, no effect dep).
        onDimensionsRef.current?.({ widthPx: pdfCanvas.width, heightPx: pdfCanvas.height });

        const renderTask = page.render({
          canvasContext: context,
          canvas: pdfCanvas,
          viewport,
          transform: [1, 0, 0, 1, offsetX, offsetY],
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        renderTaskRef.current = null;

        // Server detection used pageH=842 as fallback (pdf-parse vp.height is undefined).
        // pdfjs-dist returns the real height. Apply correction so overlays land correctly.
        const naturalPageH = viewport1.height;
        const DETECT_PAGE_H = 842;
        const yAdjust = naturalPageH - DETECT_PAGE_H;

        overlayContext.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
        overlayContext.textBaseline = "middle";

        // Single uniform font size for all value overlays — no size variation.
        const FONT = 14;
        const PAD = 3;
        const HALF_H = Math.ceil(FONT / 2) + PAD;
        const GAP = 6;
        const LABEL_W_FALLBACK = 16;

        // ── Pre-compute canvas positions for all valid overlays ──────────────
        const items = overlays
          .filter((o) => Number.isFinite(o.x) && Number.isFinite(o.y))
          .map((overlay) => {
            const correctedY = overlay.y + yAdjust;
            const rawCx = overlay.x * renderZoom + offsetX;
            const rawCy = correctedY * renderZoom + offsetY;
            return { overlay, rawCx, rawCy };
          });

        // Pre-register each label glyph's bounding box so value candidates
        // won't overlap the Lx text that's already printed in the PDF.
        const drawnBoxes: { x: number; y: number; w: number; h: number }[] =
          items.map(({ overlay, rawCx, rawCy }) => {
            const labelWidthPx =
              overlay.textWidth != null ? overlay.textWidth * renderZoom : LABEL_W_FALLBACK;
            const isRotated = !!overlay.rotation;
            if (isRotated) {
              return {
                x: rawCx - HALF_H,
                y: rawCy - labelWidthPx,
                w: FONT + PAD * 2,
                h: labelWidthPx + PAD,
              };
            } else {
              return {
                x: rawCx - PAD,
                y: rawCy - HALF_H,
                w: labelWidthPx + PAD * 2,
                h: FONT + PAD * 2,
              };
            }
          });

        // Returns total overlap area of a candidate box against all registered boxes.
        // 0 means collision-free.
        function overlapArea(box: { x: number; y: number; w: number; h: number }): number {
          let total = 0;
          for (const b of drawnBoxes) {
            const ox = Math.min(b.x + b.w, box.x + box.w) - Math.max(b.x, box.x);
            const oy = Math.min(b.y + b.h, box.y + box.h) - Math.max(b.y, box.y);
            if (ox > 0 && oy > 0) total += ox * oy;
          }
          return total;
        }

        // Set font once — it is now uniform for all overlays.
        overlayContext.font = `bold ${FONT}px Inter, sans-serif`;

        for (let i = 0; i < items.length; i++) {
          const { overlay, rawCx, rawCy } = items[i];

          const text = overlay.value;
          const tw = overlayContext.measureText(text).width;
          const isRotated = !!overlay.rotation;

          // labelWidthPx: advance width of the Lx glyph in canvas px.
          const labelWidthPx =
            overlay.textWidth != null ? overlay.textWidth * renderZoom : LABEL_W_FALLBACK;

          // Horizontal centre of the Lx glyph.
          const labelCenterX = isRotated ? rawCx : rawCx + labelWidthPx / 2;

          // Generate 24 candidates: 8 directions × 3 progressively larger distances.
          // Direction order (preference): below, right, above, left, then diagonals.
          const rawCandidates: Array<{ vx: number; vy: number }> = [];
          for (const dist of [1.0, 1.8, 3.2]) {
            const dV = (GAP + HALF_H) * dist;
            const dH = GAP * dist;
            rawCandidates.push(
              { vx: labelCenterX - tw / 2,           vy: rawCy + dV },               // below
              { vx: rawCx + labelWidthPx + dH,       vy: rawCy },                    // right
              { vx: labelCenterX - tw / 2,           vy: rawCy - dV },               // above
              { vx: rawCx - tw - dH,                 vy: rawCy },                    // left
              { vx: labelCenterX + dH,               vy: rawCy + dV },               // bottom-right
              { vx: labelCenterX - tw - dH,          vy: rawCy + dV },               // bottom-left
              { vx: labelCenterX + dH,               vy: rawCy - dV },               // top-right
              { vx: labelCenterX - tw - dH,          vy: rawCy - dV },               // top-left
            );
          }

          // Clamp every candidate to canvas bounds.
          const candidates = rawCandidates.map(({ vx, vy }) => ({
            vx: Math.max(PAD, Math.min(vx, pdfCanvas.width - tw - PAD)),
            vy: Math.max(HALF_H, Math.min(vy, pdfCanvas.height - HALF_H)),
          }));

          // Pick first collision-free candidate; if all collide, pick the one
          // with the smallest total overlap area so we always show something readable.
          let chosen = candidates[0];
          let bestOverlap = Infinity;
          for (const c of candidates) {
            const box = { x: c.vx - PAD, y: c.vy - HALF_H, w: tw + PAD * 2, h: FONT + PAD * 2 };
            const area = overlapArea(box);
            if (area === 0) { chosen = c; break; }
            if (area < bestOverlap) { bestOverlap = area; chosen = c; }
          }

          const { vx, vy } = chosen;
          const box = { x: vx - PAD, y: vy - HALF_H, w: tw + PAD * 2, h: FONT + PAD * 2 };
          drawnBoxes.push(box);

          overlayContext.fillStyle = "rgba(230,235,240,0.88)";
          overlayContext.fillRect(box.x, box.y, box.w, box.h);
          overlayContext.fillStyle = "#4A5568";
          overlayContext.fillText(text, vx, vy);
        }

        if (active) {
          setLoading(false);
          if (onRendered) {
            // Composite PDF layer + overlay layer into one PNG snapshot.
            const composite = document.createElement("canvas");
            composite.width = pdfCanvas.width;
            composite.height = pdfCanvas.height;
            const ctx = composite.getContext("2d")!;
            ctx.drawImage(pdfCanvas, 0, 0);
            ctx.drawImage(overlayCanvas, 0, 0);
            onRendered(composite.toDataURL("image/png"));
          }
        }
      } catch (err: unknown) {
        // pdfjs throws RenderingCancelledException (type field, not an Error subclass)
        // when the render task is cancelled on cleanup. Suppress it — it is expected.
        if (
          typeof err === "object" &&
          err !== null &&
          "type" in err &&
          (err as { type?: string }).type === "RenderingCancelledException"
        ) {
          return;
        }
        console.error(err);
        if (active) {
          setError("PDF konnte nicht geladen werden.");
          setLoading(false);
        }
      }
    };

    renderPdf();
    return () => {
      active = false;
      // Cancel any in-progress pdfjs render task so it does not write to a
      // stale canvas after this effect instance is superseded.
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [url, blob, pageNumber, zoom, fitToWidth, crop, overlays, onRendered]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-auto w-full h-full flex items-center justify-center bg-gray-100 ${
        interactive ? "cursor-grab active:cursor-grabbing touch-none" : ""
      }`}
      onDoubleClick={resetView}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
          <Loader2 className="w-8 h-8 animate-spin text-[#B8CC5A]" />
        </div>
      )}
      {!loading && error && (
        <div className="flex flex-col items-center gap-2 text-[#718096] mt-16">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p className="text-sm">{error}</p>
        </div>
      )}
      {!error && (
        <div
          className="relative"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <canvas ref={pdfCanvasRef} className="block shadow-lg" />
          <canvas
            ref={overlayCanvasRef}
            className="absolute top-0 left-0 block pointer-events-none"
          />
        </div>
      )}
    </div>
  );
}
