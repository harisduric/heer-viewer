import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useAppStore } from "../store";
import { Layout } from "../components/layout";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, PanelRight, PanelRightClose, Printer } from "lucide-react";
import {
  useGetCoordinates,
  useGetSchemaLibrary,
  getGetCoordinatesQueryKey,
  getGetSchemaPageUrl,
} from "@workspace/api-client-react";
import { PdfViewer } from "../components/pdf-viewer";

const SECTION_KEYS = ["BO", "SE", "KS", "DE"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const STEP_NAMES: Record<number, string> = {
  0: "Übersicht",
  1: "BO",
  2: "SE",
  3: "KS",
  4: "DE",
  5: "Hebegurt",
};

type CropRect = { cropX: number; cropY: number; cropW: number; cropH: number };

export default function ViewerPage() {
  const [, setLocation] = useLocation();
  const parsedExecution = useAppStore((s) => s.parsedExecution);
  const [step, setStep] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [highlightedLabel, setHighlightedLabel] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printRenderedCount, setPrintRenderedCount] = useState(0);

  // Measure the PDF area so we can scale each crop to fit both dimensions.
  const pdfAreaRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [containerHeight, setContainerHeight] = useState(600);
  useEffect(() => {
    const el = pdfAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerWidth(width);
      setContainerHeight(height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A4 landscape with 8mm margins ≈ 1060 × 700 usable px at 96dpi.
  // Used to compute per-section canvas scale for the print portal.
  const PRINT_W = 1060;
  const PRINT_H = 700;

  // Trigger window.print() once all 4 sections have finished rendering.
  useEffect(() => {
    if (!printing || printRenderedCount < 4) return;
    const frame = requestAnimationFrame(() => {
      window.print();
    });
    const cleanup = () => {
      setPrinting(false);
      setPrintRenderedCount(0);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", cleanup);
    };
  }, [printing, printRenderedCount]);

  useGetSchemaLibrary(); // warm library data
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

  useEffect(() => {
    setHighlightedLabel(null);
  }, [step]);

  if (!parsedExecution) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-[#718096] text-sm">Keine Ausführungsbeschreibung geladen.</p>
          <Button onClick={() => setLocation("/")} variant="outline">Zur Importseite</Button>
        </div>
      </Layout>
    );
  }

  if (!schemaName) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-[#718096] text-sm">Keine passende Schemazeichnung gefunden.</p>
          <Button onClick={() => setLocation("/")} variant="outline">Zurück zum Import</Button>
        </div>
      </Layout>
    );
  }

  // Map step → PDF page number (1-indexed). The server extracts and returns
  // exactly the requested page, so PdfViewer always renders pageNumber={1}.
  const pdfPageNum = step === 0 ? 1 : step >= 1 && step <= 4 ? 2 : 3;
  const pdfUrl = getGetSchemaPageUrl(schemaName, pdfPageNum);

  // --- Compute overlays / crops for the current step ---

  let crop: CropRect | null = null;
  let overlays: { x: number; y: number; label: string; value: string; rotation?: number }[] = [];

  // Hebegurt: collect ALL active ANO_CODE crops with labels for multi-view
  let anoCrops: { label: string; crop: CropRect }[] = [];

  if (step === 0) {
    // Übersicht (page 1): the drawing already contains full written-out labels
    // (e.g. "AM-LÄNGE"). Overlaying dimension values produces orphaned floaters
    // with no clear association. All values are shown in the sidebar table instead.
    // overlays stays empty — page renders unmodified.
  } else if (step >= 1 && step <= 4) {
    const sKey = SECTION_KEYS[step - 1];
    const cropMap =
      (
        coords as
          | Record<string, Record<string, CropRect>>
          | undefined
      )?.["page2_crops"] ?? {};
    crop = cropMap[sKey] ?? null;
    type LabelCoord = { x: number; y: number; rotation?: number; textWidth?: number };
    const p2Sections =
      (coords as Record<string, Record<string, Record<string, LabelCoord>>> | undefined)?.[
        "page2"
      ] ?? {};
    // page2_all stores ALL occurrences per label (covers duplicate text on the drawing)
    const p2AllSections =
      (coords as Record<string, Record<string, Record<string, LabelCoord[]>>> | undefined)?.[
        "page2_all"
      ] ?? {};
    const sCoords = p2Sections[sKey] ?? {};
    const sAllCoords = p2AllSections[sKey] ?? {};
    const sData =
      (parsedExecution.sections?.[sKey as SectionKey] as Record<string, string>) ?? {};
    const all = Object.entries(sData).flatMap(([label, val]) => {
      // Prefer all-occurrences list; fall back to single coord; warn if neither
      const positions: LabelCoord[] =
        sAllCoords[label]?.length > 0
          ? sAllCoords[label]
          : sCoords[label]
          ? [sCoords[label]]
          : [];
      if (positions.length === 0) {
        console.warn(`[Viewer] Label ${label} not detected for section ${sKey} — no overlay will be shown`);
      }
      return positions.map((pos) => ({ label, value: val, x: pos.x, y: pos.y, rotation: pos.rotation, textWidth: pos.textWidth }));
    });
    overlays = highlightedLabel ? all.filter((o) => o.label === highlightedLabel) : all;
  } else if (step === 5) {
    const anoCodes = parsedExecution.anoCodes ?? [];
    const p3 = (coords as Record<string, unknown> | undefined)?.["page3"] as
      | Record<string, Record<string, CropRect>>
      | undefined;
    // Collect ALL active ANO_CODE crops, labelled "SECTION — ANO_CODE VALUE"
    anoCrops = anoCodes
      .map((ac) => {
        const secMap = p3?.[ac.section as string];
        const c = secMap?.[ac.value as string];
        return c ? { label: `${ac.section} — ANO_CODE ${ac.value}`, crop: c } : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    // For the single-crop path (first one) used as fallback
    if (anoCrops.length > 0) crop = anoCrops[0].crop;
  }

  const currentDims: Record<string, string> =
    step === 0
      ? ((parsedExecution.globalDimensions as Record<string, string>) ?? {})
      : step >= 1 && step <= 4
      ? ((parsedExecution.sections?.[SECTION_KEYS[step - 1] as SectionKey] as Record<string, string>) ?? {})
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
                <span>{STEP_NAMES[i]}</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPrintRenderedCount(0); setPrinting(true); }}
              disabled={printing}
              className="flex items-center gap-1.5 text-xs h-8 px-3"
            >
              <Printer className="w-3.5 h-3.5" />
              {printing ? "Wird gedruckt…" : "Drucken"}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setPanelOpen(!panelOpen)}>
              {panelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Main area */}
        <div className="flex flex-1 overflow-hidden">
          {/* PDF Viewer area */}
          <div ref={pdfAreaRef} className="flex-1 overflow-hidden">
            {step === 5 && anoCrops.length > 1 ? (
              // Multi-ANO Hebegurt: show all crops stacked vertically with labels
              <div className="h-full overflow-auto bg-gray-100 p-4 flex flex-col gap-6 items-center">
                {anoCrops.map(({ label, crop: aCrop }) => (
                  <div key={label} className="flex flex-col items-center gap-2 w-full max-w-2xl">
                    <div className="px-3 py-1 rounded-lg bg-[#EEF3C7] text-[#2D3748] font-semibold text-sm self-start">
                      {label}
                    </div>
                    <div
                      className="w-full shadow-lg rounded"
                      style={{ height: `${aCrop.cropH * 1.5}px`, minHeight: 120 }}
                    >
                      <PdfViewer
                        url={pdfUrl}
                        pageNumber={1}
                        scale={1.5}
                        crop={aCrop}
                        interactive={true}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Single view for all other steps (and Hebegurt with only one ANO_CODE)
              // Scale: fit the crop entirely within the available container area on both
              // axes — min(containerWidth/cropW, containerHeight/cropH).  This gives a
              // "fit to page" result for both landscape (BO/SE/DE) and portrait (KS) crops.
              <PdfViewer
                url={pdfUrl}
                pageNumber={1}
                scale={(() => {
                  const activeCrop = step === 5 && anoCrops.length === 1 ? anoCrops[0].crop : crop;
                  if (!activeCrop || containerWidth <= 50 || containerHeight <= 50) return 1.5;
                  return Math.min(
                    containerWidth / activeCrop.cropW,
                    containerHeight / activeCrop.cropH,
                  );
                })()}
                crop={step === 5 && anoCrops.length === 1 ? anoCrops[0].crop : crop}
                overlays={overlays}
                interactive={true}
              />
            )}
          </div>

          {/* Right dimension panel */}
          {panelOpen && (
            <aside className="w-64 bg-white border-l border-[#E2E8F0] overflow-y-auto shrink-0">
              <div className="p-3 border-b border-[#E2E8F0]">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#718096]">
                  {STEP_NAMES[step]}
                </p>
                {step >= 1 && step <= 4 && (
                  <p className="text-[10px] text-[#A0AEC0] mt-0.5">Klicken zum Hervorheben</p>
                )}
                {step === 5 && anoCrops.length > 0 && (
                  <p className="text-[10px] text-[#A0AEC0] mt-0.5">
                    {anoCrops.length} aktive(r) Hebegurt
                  </p>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F7F8F3]">
                    <th className="text-left px-3 py-2 text-xs font-medium text-[#718096]">Label</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-[#718096]">Maß</th>
                  </tr>
                </thead>
                <tbody>
                  {step === 5 ? (
                    anoCrops.length > 0 ? (
                      anoCrops.map(({ label }) => (
                        <tr key={label} className="border-t border-[#E2E8F0]">
                          <td colSpan={2} className="px-3 py-2 text-xs font-medium text-[#4A5568]">
                            {label}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="px-3 py-4 text-center text-[#718096] text-xs">
                          Keine ANO_CODEs
                        </td>
                      </tr>
                    )
                  ) : (
                    <>
                      {Object.entries(currentDims).map(([label, value]) => (
                        <tr
                          key={label}
                          className={`border-t border-[#E2E8F0] cursor-pointer hover:bg-[#EEF3C7] transition-colors ${
                            highlightedLabel === label ? "bg-[#EEF3C7] font-semibold" : ""
                          }`}
                          onClick={() => setHighlightedLabel(label === highlightedLabel ? null : label)}
                        >
                          <td className="px-3 py-2 font-medium">{label}</td>
                          <td className="px-3 py-2 text-right font-mono">{value}</td>
                        </tr>
                      ))}
                      {Object.keys(currentDims).length === 0 && (
                        <tr>
                          <td colSpan={2} className="px-3 py-4 text-center text-[#718096] text-xs">
                            Keine Daten
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </aside>
          )}
        </div>

        {/* Bottom nav */}
        <div className="shrink-0 bg-white border-t border-[#E2E8F0] px-4 py-3 flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Zurück
          </Button>
          <span className="text-sm font-medium text-[#718096]">
            Schritt {step + 1} / {totalSteps} — {STEP_NAMES[step]}
          </span>
          <Button size="sm" disabled={step === totalSteps - 1} onClick={() => setStep((s) => s + 1)}>
            Weiter <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
      {/* Print portal — mounted at document.body so @media print can hide #root and show this */}
      {printing && schemaName && parsedExecution &&
        createPortal(
          <>
            <style>{`
              @page { size: A4 landscape; margin: 8mm; }
              @media screen {
                #heer-print-portal {
                  position: fixed;
                  top: -9999px;
                  left: -9999px;
                  width: 100vw;
                  height: 100vh;
                  overflow: hidden;
                  pointer-events: none;
                }
              }
              @media print {
                #root { visibility: hidden; }
                #heer-print-portal {
                  position: static;
                  top: 0;
                  left: 0;
                  width: 100%;
                  visibility: visible;
                }
                .heer-print-page {
                  visibility: visible;
                  display: flex;
                  flex-direction: column;
                  width: 100vw;
                  height: 100vh;
                  padding: 8mm;
                  box-sizing: border-box;
                  background: white;
                }
                .heer-print-page * { visibility: visible; }
                .heer-print-page-title {
                  font-family: sans-serif;
                  font-size: 13pt;
                  font-weight: bold;
                  margin-bottom: 6pt;
                  color: #2D3748;
                  align-self: flex-start;
                  flex-shrink: 0;
                }
                .heer-print-pdf-area {
                  flex: 1;
                  min-height: 0;
                  width: 100%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: white !important;
                }
                .heer-print-pdf-area > div {
                  background: white !important;
                }
              }
            `}</style>
            <div id="heer-print-portal">
              {SECTION_KEYS.map((sKey, idx) => {
                type LabelCoord = { x: number; y: number; rotation?: number; textWidth?: number };
                const cropMap =
                  (coords as Record<string, Record<string, CropRect>> | undefined)?.[
                    "page2_crops"
                  ] ?? {};
                const sectionCrop: CropRect | null = cropMap[sKey] ?? null;
                const p2Sections =
                  (coords as Record<string, Record<string, Record<string, LabelCoord>>> | undefined)?.[
                    "page2"
                  ] ?? {};
                const p2AllSections =
                  (coords as Record<string, Record<string, Record<string, LabelCoord[]>>> | undefined)?.[
                    "page2_all"
                  ] ?? {};
                const sCoords = p2Sections[sKey] ?? {};
                const sAllCoords = p2AllSections[sKey] ?? {};
                const sData =
                  (parsedExecution.sections?.[sKey as SectionKey] as Record<string, string>) ?? {};
                const sectionOverlays = Object.entries(sData).flatMap(([label, val]) => {
                  const positions: LabelCoord[] =
                    sAllCoords[label]?.length > 0
                      ? sAllCoords[label]
                      : sCoords[label]
                      ? [sCoords[label]]
                      : [];
                  return positions.map((pos) => ({
                    label,
                    value: val,
                    x: pos.x,
                    y: pos.y,
                    rotation: pos.rotation,
                    textWidth: pos.textWidth,
                  }));
                });
                const printScale = sectionCrop
                  ? Math.min(PRINT_W / sectionCrop.cropW, PRINT_H / sectionCrop.cropH)
                  : 2;
                return (
                  <div
                    key={sKey}
                    className="heer-print-page"
                    style={{ breakAfter: idx < SECTION_KEYS.length - 1 ? "page" : "auto" }}
                  >
                    <p className="heer-print-page-title">{sKey}</p>
                    <div className="heer-print-pdf-area">
                      <PdfViewer
                        url={getGetSchemaPageUrl(schemaName, 2)}
                        pageNumber={1}
                        scale={printScale}
                        crop={sectionCrop}
                        overlays={sectionOverlays}
                        interactive={false}
                        onRendered={() => setPrintRenderedCount((n) => n + 1)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </Layout>
  );
}
