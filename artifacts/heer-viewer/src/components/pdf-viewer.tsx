import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { useGesture } from "@use-gesture/react";
import { Loader2, AlertCircle } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  url?: string;
  blob?: Blob;
  pageNumber?: number;
  scale?: number;
  crop?: { cropX: number; cropY: number; cropW: number; cropH: number } | null;
  overlays?: { x: number; y: number; label: string; value: string; rotation?: number; textWidth?: number }[];
  interactive?: boolean;
  onRendered?: (dataUrl: string) => void;
}

export function PdfViewer({
  url,
  blob,
  pageNumber = 1,
  scale = 1,
  crop,
  overlays = [],
  interactive = false,
  onRendered,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [zoom, setZoom] = useState(scale);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Sync external scale prop into zoom (e.g. when container resizes)
  useEffect(() => {
    setZoom(scale);
  }, [scale]);

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
        const viewport = page.getViewport({ scale: zoom });

        const pdfCanvas = pdfCanvasRef.current;
        const overlayCanvas = overlayCanvasRef.current;
        if (!pdfCanvas || !overlayCanvas || !active) return;

        const context = pdfCanvas.getContext("2d")!;
        const overlayContext = overlayCanvas.getContext("2d")!;

        let offsetX = 0;
        let offsetY = 0;

        if (crop) {
          pdfCanvas.width = crop.cropW * zoom;
          pdfCanvas.height = crop.cropH * zoom;
          offsetX = -crop.cropX * zoom;
          offsetY = -crop.cropY * zoom;
        } else {
          pdfCanvas.width = viewport.width;
          pdfCanvas.height = viewport.height;
        }
        overlayCanvas.width = pdfCanvas.width;
        overlayCanvas.height = pdfCanvas.height;

        await page.render({
          canvasContext: context,
          canvas: pdfCanvas,
          viewport,
          transform: [1, 0, 0, 1, offsetX, offsetY],
        }).promise;

        // Server detection used pageH=842 as fallback (pdf-parse vp.height is undefined).
        // pdfjs-dist returns the real height. Apply correction so overlays land correctly.
        const viewport1 = page.getViewport({ scale: 1 });
        const naturalPageH = viewport1.height;
        const DETECT_PAGE_H = 842;
        const yAdjust = naturalPageH - DETECT_PAGE_H;

        overlayContext.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
        overlayContext.textBaseline = "middle";

        const FONT_LARGE = 18; // non-clustered labels
        const FONT_SMALL = 13; // labels with a neighbour within CLUSTER_RADIUS PDF pts
        // Labels closer than this (in PDF points) share the smaller font to reduce overlap.
        const CLUSTER_RADIUS = 60;
        const PAD = 3;   // padding inside the value's background highlight
        // Visual gap (canvas px) between the END of the Lx glyph and the START of the value.
        // Kept small — the label-end is computed precisely from textWidth * zoom.
        const GAP = 5;
        // Fallback label width (canvas px) when textWidth is absent (old DB entries).
        const LABEL_W_FALLBACK = 16;

        // ── Pre-compute canvas positions for all valid overlays ──────────────
        const items = overlays
          .filter((o) => Number.isFinite(o.x) && Number.isFinite(o.y))
          .map((overlay) => {
            const correctedY = overlay.y + yAdjust;
            const rawCx = overlay.x * zoom + offsetX;
            const rawCy = correctedY * zoom + offsetY;
            return { overlay, rawCx, rawCy };
          });

        // Assign per-item font size: a label gets FONT_SMALL when any other overlay
        // anchor is within CLUSTER_RADIUS PDF points (tight groups like L2/L3/L4,
        // L7/L9, L11/L12/L13). Comparison is in PDF point space, independent of zoom.
        const fontSizes = items.map((item, i) =>
          items.some((other, j) => {
            if (j === i) return false;
            const dx = item.overlay.x - other.overlay.x;
            const dy = item.overlay.y - other.overlay.y;
            return Math.sqrt(dx * dx + dy * dy) < CLUSTER_RADIUS;
          })
            ? FONT_SMALL
            : FONT_LARGE
        );

        // ── Draw value labels next to their Lx anchor ───────────────────────
        // The original Lx text on the PDF is left completely untouched.
        // Anchor point (rawCx, rawCy) is the baseline-left corner of the Lx glyph.
        //
        // For horizontal labels (rotation=0):
        //   - rawCx is the LEFT edge of the string; text extends rightward.
        //   - Value placed after the right end: vx = rawCx + labelWidthPx + GAP
        //
        // For rotation=90° CCW labels:
        //   - The PDF baseline advances in +y_pdf (upward PDF space), which after
        //     the Y-flip becomes -y_screen (upward in screen space).
        //   - rawCy IS the BOTTOM edge of the visible Lx string; text extends upward.
        //   - Value placed just below rawCy: vy = rawCy + GAP   (no labelWidthPx needed)
        //
        // Collision detection: skip any value box that overlaps an already-drawn one.

        const drawnBoxes: { x: number; y: number; w: number; h: number }[] = [];

        function hasCollision(box: { x: number; y: number; w: number; h: number }): boolean {
          for (const b of drawnBoxes) {
            const overlapX = Math.min(b.x + b.w, box.x + box.w) - Math.max(b.x, box.x);
            const overlapY = Math.min(b.y + b.h, box.y + box.h) - Math.max(b.y, box.y);
            if (overlapX > 0 && overlapY > 0) return true;
          }
          return false;
        }

        for (let i = 0; i < items.length; i++) {
          const { overlay, rawCx, rawCy } = items[i];
          const FONT = fontSizes[i];
          const HALF_H = Math.ceil(FONT / 2) + PAD;
          overlayContext.font = `bold ${FONT}px Inter, sans-serif`;

          const text = overlay.value;
          const tw = overlayContext.measureText(text).width;
          const isRotated = !!overlay.rotation;

          // labelWidthPx: the rendered advance width of the Lx glyph in canvas pixels.
          // overlay.textWidth is in PDF points; multiply by zoom to get canvas px.
          const labelWidthPx =
            overlay.textWidth != null ? overlay.textWidth * zoom : LABEL_W_FALLBACK;

          // Place value after the label end + GAP
          let vx: number;
          let vy: number;
          if (isRotated) {
            // rawCy is already the bottom of the Lx string — text goes upward.
            // Place value just below that bottom edge.
            vx = rawCx;
            vy = rawCy + GAP + HALF_H;
          } else {
            // rawCx is the left edge — skip past the full string width then add gap.
            vx = rawCx + labelWidthPx + GAP;
            vy = rawCy;
          }

          // Clamp so value never renders outside the visible canvas
          vx = Math.max(PAD, Math.min(vx, pdfCanvas.width - tw - PAD));
          vy = Math.max(HALF_H, Math.min(vy, pdfCanvas.height - HALF_H));

          const box = { x: vx - PAD, y: vy - HALF_H, w: tw + PAD * 2, h: FONT + PAD * 2 };
          if (hasCollision(box)) continue;
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
      } catch (err) {
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
    };
  }, [url, blob, pageNumber, zoom, crop, overlays]);

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
