import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAppStore } from "../store";
import { Layout } from "../components/layout";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, PanelRight, PanelRightClose } from "lucide-react";
import {
  useGetCoordinates,
  useGetSchemaLibrary,
  getGetCoordinatesQueryKey,
} from "@workspace/api-client-react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

const SECTION_KEYS = ["BO", "SE", "KS", "DE"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

interface Coord { x: number; y: number }
interface Crop { cropX: number; cropY: number; cropW: number; cropH: number }

async function renderPdfPage(
  pdfCanvas: HTMLCanvasElement,
  overlayCanvas: HTMLCanvasElement,
  pdfData: Uint8Array,
  pageNum: number,
  scale: number,
  crop: Crop | null,
  overlays: { label: string; value: string; x: number; y: number }[]
): Promise<void> {
  const task = pdfjsLib.getDocument({ data: pdfData });
  const pdf = await task.promise;
  const page = await pdf.getPage(pageNum);
  const baseVp = page.getViewport({ scale });

  let w = baseVp.width;
  let h = baseVp.height;
  let offsetX = 0;
  let offsetY = 0;

  if (crop) {
    w = crop.cropW * scale;
    h = crop.cropH * scale;
    offsetX = -crop.cropX * scale;
    offsetY = -crop.cropY * scale;
  }

  pdfCanvas.width = w;
  pdfCanvas.height = h;
  overlayCanvas.width = w;
  overlayCanvas.height = h;

  const ctx = pdfCanvas.getContext("2d")!;
  await page.render({
    canvasContext: ctx,
    canvas: pdfCanvas,
    viewport: baseVp,
    transform: [1, 0, 0, 1, offsetX, offsetY],
  }).promise;

  const octx = overlayCanvas.getContext("2d")!;
  octx.clearRect(0, 0, w, h);
  octx.font = "bold 11px Inter, sans-serif";
  octx.textBaseline = "middle";

  for (const ov of overlays) {
    const cx = ov.x * scale + (crop ? offsetX : 0);
    const cy = ov.y * scale + (crop ? offsetY : 0);
    const text = `${ov.label}: ${ov.value}`;
    const tw = octx.measureText(text).width;
    octx.fillStyle = "#FFFFFF";
    octx.fillRect(cx - 2, cy - 7, tw + 6, 14);
    octx.fillStyle = "#4A5568";
    octx.fillText(text, cx, cy);
  }
}

export default function ViewerPage() {
  const [, setLocation] = useLocation();
  const parsedExecution = useAppStore((s) => s.parsedExecution);
  const [step, setStep] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlightedLabel, setHighlightedLabel] = useState<string | null>(null);

  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const { data: _library } = useGetSchemaLibrary();
  const schemaName = parsedExecution?.matchedSchema ?? null;

  const { data: coordData } = useGetCoordinates(schemaName ?? "", {
    query: {
      enabled: !!schemaName,
      queryKey: getGetCoordinatesQueryKey(schemaName ?? ""),
    },
  });

  const coords = coordData as Record<string, unknown> | undefined;

  const hasHebegurt = (parsedExecution?.anoCodes ?? []).length > 0;
  const totalSteps = hasHebegurt ? 6 : 5;

  const stepNames: Record<number, string> = {
    0: "Übersicht",
    1: "BO",
    2: "SE",
    3: "KS",
    4: "DE",
    5: "Hebegurt",
  };

  useEffect(() => {
    if (!schemaName) return;
    const pageNum = step === 0 ? 1 : step === 5 ? 3 : 2;
    setLoading(true);
    fetch(`/api/schema/${schemaName}/page/${pageNum}`)
      .then((r) => r.arrayBuffer())
      .then((ab) => {
        setPdfData(new Uint8Array(ab));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [schemaName, step]);

  useEffect(() => {
    if (!pdfData || !pdfCanvasRef.current || !overlayCanvasRef.current) return;
    if (!coords) return;

    const pageNum = step === 0 ? 1 : step === 5 ? 3 : 2;
    let crop: Crop | null = null;
    let overlays: { label: string; value: string; x: number; y: number }[] = [];

    if (step === 0) {
      const p1 = (coords as Record<string, Record<string, Coord>>)["page1"] ?? {};
      const dims = parsedExecution?.globalDimensions ?? {};
      overlays = Object.entries(dims)
        .map(([key, val]) => {
          const c = p1[key];
          return c ? { label: key, value: String(val), x: c.x, y: c.y } : null;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
    } else if (step >= 1 && step <= 4) {
      const sKey = SECTION_KEYS[step - 1];
      const cropMap = (coords as Record<string, Record<string, Crop>>)["page2_crops"] ?? {};
      crop = cropMap[sKey] ?? null;
      const p2Sections = (coords as Record<string, Record<string, Record<string, Coord>>>)["page2"] ?? {};
      const sCoords = p2Sections[sKey] ?? {};
      const sData = parsedExecution?.sections?.[sKey as SectionKey] ?? {};
      overlays = Object.entries(sData as Record<string, string>)
        .map(([label, val]) => {
          const c = sCoords[label];
          return c ? { label, value: val, x: c.x, y: c.y } : null;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
    } else if (step === 5) {
      const p3 = (coords as Record<string, unknown>)["page3"] as Record<string, Record<string, Crop>> | undefined;
      const anoCodes = parsedExecution?.anoCodes ?? [];
      for (const ac of anoCodes) {
        const sec = p3?.[ac.section];
        const c = sec?.[ac.value];
        if (c) { crop = c; break; }
      }
    }

    renderPdfPage(
      pdfCanvasRef.current,
      overlayCanvasRef.current,
      pdfData,
      pageNum,
      1.5,
      crop,
      overlays
    ).catch(console.error);
  }, [pdfData, step, coords, parsedExecution, highlightedLabel]);

  if (!parsedExecution) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-[#718096] text-sm">
            Keine Ausführungsbeschreibung geladen.
          </p>
          <Button onClick={() => setLocation("/")} variant="outline">
            Zur Importseite
          </Button>
        </div>
      </Layout>
    );
  }

  const currentSectionKey =
    step >= 1 && step <= 4 ? SECTION_KEYS[step - 1] : null;
  const currentDims: Record<string, string> = currentSectionKey
    ? (parsedExecution.sections?.[currentSectionKey as SectionKey] as Record<string, string> ?? {})
    : step === 0
    ? (parsedExecution.globalDimensions as Record<string, string> ?? {})
    : {};

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-56px-32px)] overflow-hidden">
        {/* Stepper */}
        <div className="flex items-center gap-1 px-4 py-3 bg-white border-b border-[#E2E8F0] overflow-x-auto shrink-0">
          {Array.from({ length: totalSteps }, (_, i) => {
            const isActive = i === step;
            const isDone = i < step;
            return (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors border
                  ${isActive
                    ? "bg-[#B8CC5A] text-[#2D3748] border-[#B8CC5A]"
                    : isDone
                    ? "bg-[#EEF3C7] text-[#4A5568] border-[#EEF3C7]"
                    : "bg-[#F7F8F3] text-[#718096] border-[#E2E8F0]"
                  }`}
              >
                {isDone && <span>✓</span>}
                <span>{stepNames[i]}</span>
              </button>
            );
          })}
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPanelOpen(!panelOpen)}
            >
              {panelOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRight className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Main area */}
        <div className="flex flex-1 overflow-hidden">
          {/* PDF Canvas */}
          <div className="flex-1 relative overflow-auto bg-gray-100 flex items-center justify-center">
            {loading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-[#B8CC5A] border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-[#718096]">Lade PDF...</span>
              </div>
            ) : !schemaName ? (
              <div className="text-[#718096] text-sm">
                Keine Schemazeichnung gefunden
              </div>
            ) : (
              <div className="relative">
                <canvas ref={pdfCanvasRef} className="block shadow-lg" />
                <canvas
                  ref={overlayCanvasRef}
                  className="absolute top-0 left-0 pointer-events-none"
                />
              </div>
            )}
          </div>

          {/* Right dimension panel */}
          {panelOpen && (
            <aside className="w-64 bg-white border-l border-[#E2E8F0] overflow-y-auto shrink-0">
              <div className="p-3 border-b border-[#E2E8F0]">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#718096]">
                  {stepNames[step]}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F7F8F3]">
                    <th className="text-left px-3 py-2 text-xs font-medium text-[#718096]">
                      Label
                    </th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-[#718096]">
                      Maß
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(currentDims).map(([label, value]) => (
                    <tr
                      key={label}
                      className={`border-t border-[#E2E8F0] cursor-pointer hover:bg-[#EEF3C7] transition-colors ${
                        highlightedLabel === label
                          ? "bg-[#EEF3C7] font-semibold"
                          : ""
                      }`}
                      onClick={() =>
                        setHighlightedLabel(
                          label === highlightedLabel ? null : label
                        )
                      }
                    >
                      <td className="px-3 py-2 font-medium">{label}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {value}
                      </td>
                    </tr>
                  ))}
                  {Object.keys(currentDims).length === 0 && (
                    <tr>
                      <td
                        colSpan={2}
                        className="px-3 py-4 text-center text-[#718096] text-xs"
                      >
                        Keine Daten
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </aside>
          )}
        </div>

        {/* Bottom nav */}
        <div className="shrink-0 bg-white border-t border-[#E2E8F0] px-4 py-3 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Zurück
          </Button>
          <span className="text-sm font-medium text-[#718096]">
            Schritt {step + 1} / {totalSteps} — {stepNames[step]}
          </span>
          <Button
            size="sm"
            disabled={step === totalSteps - 1}
            onClick={() => setStep((s) => s + 1)}
          >
            Weiter <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </Layout>
  );
}
