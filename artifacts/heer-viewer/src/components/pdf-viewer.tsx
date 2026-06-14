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
  overlays?: { x: number; y: number; label: string; value: string }[];
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

        // Server-side detection used pageH=842 as fallback (pdf-parse vp.height
        // is undefined). pdfjs-dist v5 returns the real height. Correct the gap.
        const viewport1 = page.getViewport({ scale: 1 });
        const naturalPageH = viewport1.height;
        const DETECT_PAGE_H = 842;
        const yAdjust = naturalPageH - DETECT_PAGE_H;

        overlayContext.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
        overlayContext.font = "bold 13px Inter, sans-serif";
        overlayContext.textBaseline = "middle";

        const PAD = 4;
        const TEXT_H = 13;
        const HALF_H = Math.ceil(TEXT_H / 2) + PAD; // ~11px

        for (const overlay of overlays) {
          if (!Number.isFinite(overlay.x) || !Number.isFinite(overlay.y)) continue;

          // Correct Y for the pageH discrepancy
          const correctedY = overlay.y + yAdjust;
          const rawCx = overlay.x * zoom + offsetX;
          const rawCy = correctedY * zoom + offsetY;

          const text = overlay.value; // value only — not "L1: value"
          const tw = overlayContext.measureText(text).width;

          // Clamp so text never renders outside the visible canvas
          const cx = Math.max(PAD, Math.min(rawCx, pdfCanvas.width - tw - PAD));
          const cy = Math.max(HALF_H, Math.min(rawCy, pdfCanvas.height - HALF_H));

          overlayContext.fillStyle = "rgba(255,255,255,0.92)";
          overlayContext.fillRect(cx - PAD, cy - HALF_H, tw + PAD * 2, TEXT_H + PAD * 2);
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
      className={`relative overflow-hidden w-full h-full flex items-center justify-center bg-gray-100 ${
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
        <div className="flex flex-col items-center gap-2 text-[#718096]">
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
