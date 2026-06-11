import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { useGesture } from "@use-gesture/react";
import { Loader2 } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  url?: string;
  blob?: Blob;
  pageNumber: number;
  scale?: number;
  crop?: { cropX: number; cropY: number; cropW: number; cropH: number } | null;
  overlays?: { x: number; y: number; label: string; value: string }[];
  interactive?: boolean;
}

export function PdfViewer({ url, blob, pageNumber, scale = 1, crop, overlays = [], interactive = false }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  
  // To handle interactive state locally
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
      }
    },
    { target: containerRef, eventOptions: { passive: false } }
  );

  const resetView = () => {
    setZoom(scale);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    let active = true;
    const renderPdf = async () => {
      if (!url && !blob) return;
      setLoading(true);
      try {
        let pdfData;
        if (blob) {
          pdfData = new Uint8Array(await blob.arrayBuffer());
        } else if (url) {
          const res = await fetch(url);
          pdfData = new Uint8Array(await res.arrayBuffer());
        }
        
        if (!pdfData || !active) return;
        
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNumber);
        
        const viewport = page.getViewport({ scale: zoom });
        
        const pdfCanvas = pdfCanvasRef.current;
        const overlayCanvas = overlayCanvasRef.current;
        if (!pdfCanvas || !overlayCanvas) return;
        
        const context = pdfCanvas.getContext("2d");
        const overlayContext = overlayCanvas.getContext("2d");
        if (!context || !overlayContext) return;
        
        let targetViewport = viewport;
        let drawScale = 1;
        let offsetX = 0;
        let offsetY = 0;

        if (crop) {
          // Adjust viewport for crop
          targetViewport = page.getViewport({ scale: zoom });
          pdfCanvas.width = crop.cropW * zoom;
          pdfCanvas.height = crop.cropH * zoom;
          overlayCanvas.width = crop.cropW * zoom;
          overlayCanvas.height = crop.cropH * zoom;
          offsetX = -crop.cropX * zoom;
          offsetY = -crop.cropY * zoom;
        } else {
          pdfCanvas.width = viewport.width;
          pdfCanvas.height = viewport.height;
          overlayCanvas.width = viewport.width;
          overlayCanvas.height = viewport.height;
        }

        const renderContext = {
          canvasContext: context,
          canvas: pdfCanvas,
          viewport: targetViewport,
          transform: [1, 0, 0, 1, offsetX, offsetY]
        };

        await page.render(renderContext).promise;

        // Draw overlays
        overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayContext.font = "bold 11px Inter";
        overlayContext.textBaseline = "middle";
        
        overlays.forEach(overlay => {
          let cx = overlay.x * zoom + offsetX;
          let cy = overlay.y * zoom + offsetY;
          
          const text = `${overlay.label}: ${overlay.value}`;
          const metrics = overlayContext.measureText(text);
          const bgWidth = metrics.width + 4; // 2px padding each side
          const bgHeight = 15;
          
          overlayContext.fillStyle = "#FFFFFF";
          overlayContext.fillRect(cx - 2, cy - bgHeight/2, bgWidth, bgHeight);
          
          overlayContext.fillStyle = "#4A5568";
          overlayContext.fillText(text, cx, cy);
        });
        
        if (active) setLoading(false);
      } catch (err) {
        console.error(err);
      }
    };
    renderPdf();
    return () => { active = false; };
  }, [url, blob, pageNumber, zoom, crop, overlays]);

  return (
    <div 
      ref={containerRef}
      className={`relative overflow-hidden w-full h-full flex items-center justify-center bg-gray-100 ${interactive ? 'cursor-grab active:cursor-grabbing touch-none' : ''}`}
      onDoubleClick={resetView}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      )}
      <div 
        className="relative"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
      >
        <canvas ref={pdfCanvasRef} className="block" />
        <canvas ref={overlayCanvasRef} className="absolute top-0 left-0 block pointer-events-none" />
      </div>
    </div>
  );
}

