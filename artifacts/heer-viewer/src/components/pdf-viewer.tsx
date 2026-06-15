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
  overlays?: {
    x: number;
    y: number;
    label: string;
    value: string;
    rotation?: number;
    /** Advance width of the original L-label glyph in PDF points (from pdfjs item.width). */
    textWidth?: number;
    /** Em-square height of the original L-label in PDF points (from font size). */
    textHeight?: number;
  }[];
  interactive?: boolean;
}

export function PdfViewer({
  url,
  blob,
  pageNumber = 1,
  scale = 1,
  crop,
  overlays = [],
  interactive = false,
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

        const PAD = 6;
        const FONT_NORMAL = 13;
        const FONT_SMALL = 11;

        // ── Pre-compute canvas positions for all valid overlays ──────────────
        const items = overlays
          .filter((o) => Number.isFinite(o.x) && Number.isFinite(o.y))
          .map((overlay) => {
            const correctedY = overlay.y + yAdjust;
            const rawCx = overlay.x * zoom + offsetX;
            const rawCy = correctedY * zoom + offsetY;
            return { overlay, rawCx, rawCy };
          });

        // ── Cluster detection: count how many other labels are within radius ──
        // If 2+ neighbours → use smaller font to give breathing room.
        const CLUSTER_RADIUS = 55; // canvas pixels
        const fontSizes = items.map((item, i) => {
          const neighbours = items.filter(
            (other, j) =>
              j !== i &&
              Math.hypot(item.rawCx - other.rawCx, item.rawCy - other.rawCy) < CLUSTER_RADIUS
          ).length;
          return neighbours >= 2 ? FONT_SMALL : FONT_NORMAL;
        });

        // ── Draw overlays with collision detection ──────────────────────────
        // Track bounding boxes of already-drawn overlays.
        // Skip any new overlay that overlaps >30% with an existing one.
        const drawnBoxes: { x: number; y: number; w: number; h: number }[] = [];

        function hasCollision(box: { x: number; y: number; w: number; h: number }): boolean {
          for (const b of drawnBoxes) {
            const ix = Math.max(
              0,
              Math.min(b.x + b.w, box.x + box.w) - Math.max(b.x, box.x)
            );
            const iy = Math.max(
              0,
              Math.min(b.y + b.h, box.y + box.h) - Math.max(b.y, box.y)
            );
            const interArea = ix * iy;
            const minArea = Math.min(b.w * b.h, box.w * box.h);
            if (minArea > 0 && interArea / minArea > 0.3) return true;
          }
          return false;
        }

        for (let i = 0; i < items.length; i++) {
          const { overlay, rawCx, rawCy } = items[i];
          const fontSize = fontSizes[i];
          const HALF_H = Math.ceil(fontSize / 2) + PAD;

          overlayContext.font = `bold ${fontSize}px Inter, sans-serif`;
          const text = overlay.value;
          const tw = overlayContext.measureText(text).width;

          // Clamp so text never renders outside the visible canvas
          const cx = Math.max(PAD, Math.min(rawCx, pdfCanvas.width - tw - PAD));
          const cy = Math.max(HALF_H, Math.min(rawCy, pdfCanvas.height - HALF_H));

          const box = {
            x: cx - PAD,
            y: cy - HALF_H,
            w: tw + PAD * 2,
            h: fontSize + PAD * 2,
          };

          // Skip if this box overlaps >30% with any already-drawn box
          if (hasCollision(box)) continue;

          drawnBoxes.push(box);

          // ── Rotated cover for original L-label ──────────────────────────────
          // When the stored label has a non-zero rotation (90° CCW, -90° CW, etc.),
          // the axis-aligned cover below won't fully hide the rotated glyphs.
          // Draw a cover rect rotated to match the original text angle, sized to
          // exactly the glyph's own advance-width × em-height + 2px pad only.
          // This keeps the cover tight so it doesn't bleed onto adjacent red lines.
          if (overlay.rotation && overlay.textWidth && overlay.textHeight) {
            const rotRad = overlay.rotation * (Math.PI / 180);
            const COVER_PAD = 2; // px — just enough to fully hide anti-aliased edges
            const twPx = overlay.textWidth * zoom;  // glyph advance width in canvas px
            const thPx = overlay.textHeight * zoom; // em-square height in canvas px
            overlayContext.save();
            overlayContext.translate(rawCx, rawCy);
            overlayContext.rotate(rotRad);
            overlayContext.fillStyle = "rgba(255,255,255,0.97)";
            // Origin is at the baseline-left corner of the original glyph.
            // x: from -COVER_PAD (before start) to twPx + COVER_PAD (after end).
            // y: from -(thPx + COVER_PAD) (above baseline) to +COVER_PAD (below).
            overlayContext.fillRect(
              -COVER_PAD,
              -(thPx + COVER_PAD),
              twPx + 2 * COVER_PAD,
              thPx + 2 * COVER_PAD
            );
            overlayContext.restore();
          }

          overlayContext.fillStyle = "rgba(255,255,255,0.92)";
          overlayContext.fillRect(box.x, box.y, box.w, box.h);
          overlayContext.fillStyle = "#4A5568";
          overlayContext.fillText(text, cx, cy);
        }

        if (active) setLoading(false);
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
      className={`relative overflow-auto w-full h-full flex flex-col items-center bg-gray-100 ${
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
