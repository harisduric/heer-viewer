import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useAppStore } from "../store";
import { Layout } from "../components/layout";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, PanelRight, PanelRightClose, Printer } from "lucide-react";
import {
  useGetCoordinates,
  useGetSchemaLibrary,
  useGetSchemaPageCount,
  getGetCoordinatesQueryKey,
  getGetSchemaPageCountQueryKey,
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
  5: "Hebegurte",
};

type CropRect = { cropX: number; cropY: number; cropW: number; cropH: number };

export default function ViewerPage() {
  const [, setLocation] = useLocation();
  const parsedExecution = useAppStore((s) => s.parsedExecution);
  const [step, setStep] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [highlightedLabel, setHighlightedLabel] = useState<string | null>(null);
  // Capture state — ref avoids stale-closure issues across sequential renders.
  const captureQueueRef = useRef<{
    phase: "main" | "hebegurt";
    mainStep: 0 | 1 | 2 | 3 | 4;
    hebegurtIdx: number;
    hebegurtPageNums: number[];
    images: string[];
    originalStep: number;
  } | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hebegurtCaptureTick, setHebegurtCaptureTick] = useState(0);
  const [printImages, setPrintImages] = useState<string[] | null>(null);

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

  // Advances capture through steps 0–4 (main phase) then Hebegurt pages (hebegurt phase).
  // Wrapped in useCallback so the reference is stable — PdfViewer lists onRendered as a dep.
  const handlePrintRendered = useCallback((dataUrl: string) => {
    const q = captureQueueRef.current;
    if (!q) return;
    q.images.push(dataUrl);

    if (q.phase === "main") {
      if (q.mainStep < 4) {
        q.mainStep = (q.mainStep + 1) as 1 | 2 | 3 | 4;
        setStep(q.mainStep);
      } else if (q.hebegurtPageNums.length > 0) {
        // Transition to Hebegurt capture phase
        q.phase = "hebegurt";
        q.hebegurtIdx = 0;
        setStep(5);
      } else {
        captureQueueRef.current = null;
        setIsCapturing(false);
        setPrintImages([...q.images]);
        setStep(q.originalStep);
      }
    } else {
      // Hebegurt phase — advance to next page or finish
      q.hebegurtIdx++;
      if (q.hebegurtIdx < q.hebegurtPageNums.length) {
        // Trigger re-render so PdfViewer gets the next page URL
        setHebegurtCaptureTick((t) => t + 1);
      } else {
        captureQueueRef.current = null;
        setIsCapturing(false);
        setPrintImages([...q.images]);
        setStep(q.originalStep);
      }
    }
  }, []); // stable — only reads from ref, calls stable React setters

  // Once all 5 images are ready, open the print dialog.
  // The portal renders the images first (before this effect runs) because
  // React commits DOM changes before firing effects.
  useEffect(() => {
    if (!printImages || printImages.length === 0) return;
    window.print();
    const cleanup = () => setPrintImages(null);
    window.addEventListener("afterprint", cleanup, { once: true });
    return () => window.removeEventListener("afterprint", cleanup);
  }, [printImages]);

  useGetSchemaLibrary(); // warm library data
  const schemaName = parsedExecution?.matchedSchema ?? null;

  const { data: coordData } = useGetCoordinates(schemaName ?? "", {
    query: {
      enabled: !!schemaName,
      queryKey: getGetCoordinatesQueryKey(schemaName ?? ""),
    },
  });

  const coords = coordData as Record<string, unknown> | undefined;

  // Active ANO_CODEs — value "0" = not applicable (filtered out)
  const activeAnoCodes = (parsedExecution?.anoCodes ?? []).filter(
    (ac) => ac.value !== "0",
  );

  // Hebegurt start page from schema coordinates (null if not configured)
  const hebegurtStartPage =
    typeof coords?.["hebegurtStartPage"] === "number"
      ? (coords["hebegurtStartPage"] as number)
      : null;

  // Hebegurt step appears when execution has active ANO_CODEs AND schema has a start page
  const hasHebegurt = activeAnoCodes.length > 0 && !!hebegurtStartPage;

  const totalSteps = hasHebegurt ? 6 : 5;

  // Fetch total page count so we know which pages to show in the Hebegurt step
  const { data: pageCountData } = useGetSchemaPageCount(schemaName ?? "", {
    query: {
      enabled: hasHebegurt && !!schemaName,
      queryKey: getGetSchemaPageCountQueryKey(schemaName ?? ""),
    },
  });
  const numPages = pageCountData?.numPages ?? null;

  // PDF page numbers for the Hebegurt step (hebegurtStartPage … numPages)
  const hebegurtPageNums: number[] =
    hebegurtStartPage !== null && numPages !== null
      ? Array.from(
          { length: numPages - hebegurtStartPage + 1 },
          (_, i) => hebegurtStartPage + i,
        )
      : [];

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

  // URL for the current Hebegurt page during capture (changes with hebegurtCaptureTick).
  // hebegurtCaptureTick >= 0 is always true but establishes the reactivity dependency.
  const captureHebegurtUrl =
    isCapturing &&
    captureQueueRef.current?.phase === "hebegurt" &&
    hebegurtCaptureTick >= 0
      ? getGetSchemaPageUrl(
          schemaName,
          captureQueueRef.current.hebegurtPageNums[captureQueueRef.current.hebegurtIdx],
        )
      : null;

  // --- Compute overlays / crops for the current step ---
  // Both are memoized so their references are stable across re-renders.
  // PdfViewer lists `overlays` in its effect deps; a new [] on every render
  // would restart the PDF render loop → stuck spinner + console flood.

  type LabelCoord = { x: number; y: number; rotation?: number; textWidth?: number };

  const crop = useMemo<CropRect | null>(() => {
    if (step < 1 || step > 4 || !coords) return null;
    const sKey = SECTION_KEYS[step - 1];
    const cropMap =
      (coords as Record<string, Record<string, CropRect>> | undefined)?.["page2_crops"] ?? {};
    return cropMap[sKey] ?? null;
  }, [step, coords]);

  const overlays = useMemo(() => {
    if (step < 1 || step > 4 || !coords || !parsedExecution) return [];
    const sKey = SECTION_KEYS[step - 1];
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
      return positions.map((pos) => ({
        label,
        value: val,
        x: pos.x,
        y: pos.y,
        rotation: pos.rotation,
        textWidth: pos.textWidth,
      }));
    });
    return highlightedLabel ? all.filter((o) => o.label === highlightedLabel) : all;
  }, [step, coords, parsedExecution, highlightedLabel]);

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
                onClick={() => !isCapturing && setStep(i)}
                disabled={isCapturing}
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
              onClick={() => {
                captureQueueRef.current = {
                  phase: "main",
                  mainStep: 0,
                  hebegurtIdx: 0,
                  hebegurtPageNums: hasHebegurt ? [...hebegurtPageNums] : [],
                  images: [],
                  originalStep: step,
                };
                setIsCapturing(true);
                setStep(0);
              }}
              disabled={isCapturing}
              className="flex items-center gap-1.5 text-xs h-8 px-3"
            >
              <Printer className="w-3.5 h-3.5" />
              {isCapturing ? "Wird gedruckt…" : "Drucken"}
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
            {step === 5 ? (
              isCapturing && captureHebegurtUrl ? (
                // Capture mode: sequential single-page PdfViewer (one per Hebegurt page)
                <PdfViewer
                  url={captureHebegurtUrl}
                  pageNumber={1}
                  scale={1.5}
                  interactive={false}
                  onRendered={handlePrintRendered}
                />
              ) : (
                // Normal view: continuous scroll through all Hebegurt pages
                <div className="h-full overflow-y-auto bg-gray-100 p-4 flex flex-col items-center gap-4">
                  {hebegurtPageNums.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="w-8 h-8 animate-spin text-[#B8CC5A]" />
                    </div>
                  ) : (
                    hebegurtPageNums.map((pNum) => {
                      // containerWidth is the pdfAreaRef content-rect width from
                      // ResizeObserver.  The scroll container inside adds p-4 (32 px
                      // total horizontal padding).  On Windows/Linux a vertical
                      // scrollbar also consumes ~17 px.  Without accounting for the
                      // scrollbar, `items-center` centres an over-wide page wrapper
                      // and clips ~8 px on each side.
                      //
                      // Reserve 56 px total: 32 (p-4 padding) + 24 (scrollbar gutter).
                      // This keeps pages fully visible regardless of scrollbar width.
                      //
                      // The explicit height is required: without it the wrapper has
                      // height:auto and PdfViewer's `h-full` collapses to 0 px.
                      const SCROLL_RESERVE = 56;
                      const hebScale = Math.min(
                        1.8,
                        Math.max(0.5, (containerWidth - SCROLL_RESERVE) / 595),
                      );
                      const pageW = Math.round(595 * hebScale);
                      const pageH = Math.round(842 * hebScale);
                      return (
                        <div key={pNum} style={{ width: pageW, height: pageH, flexShrink: 0 }}>
                          <PdfViewer
                            url={getGetSchemaPageUrl(schemaName, pNum)}
                            pageNumber={1}
                            scale={hebScale}
                            interactive={false}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              )
            ) : (
              // Steps 0–4: single PdfViewer fitted to container
              <PdfViewer
                url={pdfUrl}
                pageNumber={1}
                scale={(() => {
                  if (!crop || containerWidth <= 50 || containerHeight <= 50) return 1.5;
                  return Math.min(
                    containerWidth / crop.cropW,
                    containerHeight / crop.cropH,
                  );
                })()}
                crop={crop}
                overlays={overlays}
                interactive={!isCapturing}
                onRendered={isCapturing ? handlePrintRendered : undefined}
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
                {step === 5 && activeAnoCodes.length > 0 && (
                  <p className="text-[10px] text-[#A0AEC0] mt-0.5">
                    {activeAnoCodes.length} aktive(r) ANO_CODE
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
                    activeAnoCodes.length > 0 ? (
                      activeAnoCodes.map((ac, idx) => (
                        <tr key={`${idx}-${ac.section}-${ac.value}`} className="border-t border-[#E2E8F0]">
                          <td className="px-3 py-2 text-xs font-medium text-[#4A5568]">{ac.section}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{ac.value}</td>
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
          <Button variant="outline" size="sm" disabled={step === 0 || isCapturing} onClick={() => setStep((s) => s - 1)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Zurück
          </Button>
          <span className="text-sm font-medium text-[#718096]">
            Schritt {step + 1} / {totalSteps} — {STEP_NAMES[step]}
          </span>
          <Button size="sm" disabled={step === totalSteps - 1 || isCapturing} onClick={() => setStep((s) => s + 1)}>
            Weiter <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
      {/* Print portal — 5 captured <img> snapshots (Übersicht + BO/SE/KS/DE),
          hidden on screen, shown during print.
          #root uses display:none so it takes no layout space and produces no
          phantom pages in the print preview. */}
      {printImages !== null &&
        createPortal(
          <>
            <style>{`
              @page { size: A4 landscape; margin: 8mm; }
              @media screen { #heer-print-view { display: none !important; } }
              @media print {
                #root { display: none !important; }
                #heer-print-view { display: block; }
                .heer-pv-page {
                  display: flex;
                  flex-direction: column;
                  width: 100vw;
                  height: 100vh;
                  padding: 8mm;
                  box-sizing: border-box;
                  background: white;
                }
                .heer-pv-title {
                  font-family: sans-serif;
                  font-size: 13pt;
                  font-weight: bold;
                  margin-bottom: 6pt;
                  color: #2D3748;
                  align-self: flex-start;
                  flex-shrink: 0;
                }
                .heer-pv-body {
                  flex: 1;
                  min-height: 0;
                  display: flex;
                  flex-direction: row;
                  gap: 8pt;
                  align-items: stretch;
                }
                .heer-pv-img-area {
                  flex: 1;
                  min-width: 0;
                  min-height: 0;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                }
                .heer-pv-img-area img {
                  max-width: 100%;
                  max-height: 100%;
                  object-fit: contain;
                  display: block;
                }
                .heer-pv-legend {
                  width: 110pt;
                  flex-shrink: 0;
                  font-family: sans-serif;
                  font-size: 7.5pt;
                  color: #2D3748;
                  border-left: 1pt solid #E2E8F0;
                  padding-left: 6pt;
                  overflow: hidden;
                }
                .heer-pv-legend table {
                  width: 100%;
                  border-collapse: collapse;
                }
                .heer-pv-legend th {
                  font-weight: bold;
                  text-align: left;
                  padding: 2pt 3pt;
                  border-bottom: 1pt solid #CBD5E0;
                  color: #718096;
                  font-size: 7pt;
                  text-transform: uppercase;
                  letter-spacing: 0.04em;
                }
                .heer-pv-legend td {
                  padding: 1.5pt 3pt;
                  border-bottom: 0.3pt solid #EDF2F7;
                  line-height: 1.3;
                }
                .heer-pv-legend td:last-child {
                  text-align: right;
                  font-family: monospace;
                  font-size: 7pt;
                }
              }
            `}</style>
            <div id="heer-print-view">
              {printImages.map((src, idx) => {
                const isLastPage = idx === printImages.length - 1;
                if (idx < 5) {
                  // idx 0 = Übersicht (no legend), idx 1–4 = BO/SE/KS/DE (with legend)
                  const pageTitle = idx === 0 ? "Übersicht" : SECTION_KEYS[idx - 1];
                  const sectionKey = idx > 0 ? SECTION_KEYS[idx - 1] : null;
                  const dims: Record<string, string> = sectionKey
                    ? ((parsedExecution.sections?.[sectionKey as SectionKey] as Record<string, string>) ?? {})
                    : {};
                  return (
                    <div
                      key={idx}
                      className="heer-pv-page"
                      style={{ breakAfter: isLastPage ? "auto" : "page" }}
                    >
                      <p className="heer-pv-title">{pageTitle}</p>
                      <div className="heer-pv-body">
                        <div className="heer-pv-img-area">
                          <img src={src} alt={pageTitle} />
                        </div>
                        {sectionKey !== null && Object.keys(dims).length > 0 && (
                          <div className="heer-pv-legend">
                            <table>
                              <thead>
                                <tr>
                                  <th>Label</th>
                                  <th style={{ textAlign: "right" }}>Maß</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(dims).map(([label, value]) => (
                                  <tr key={label}>
                                    <td>{label}</td>
                                    <td>{value}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                // idx >= 5: Hebegurt pages
                const isFirstHebegurt = idx === 5;
                return (
                  <div
                    key={idx}
                    className="heer-pv-page"
                    style={{ breakAfter: isLastPage ? "auto" : "page" }}
                  >
                    <p className="heer-pv-title">
                      {isFirstHebegurt ? "Hebegurte" : "Hebegurte (Forts.)"}
                    </p>
                    <div className="heer-pv-body">
                      <div className="heer-pv-img-area">
                        <img src={src} alt="Hebegurte" />
                      </div>
                      {isFirstHebegurt && activeAnoCodes.length > 0 && (
                        <div className="heer-pv-legend">
                          <table>
                            <thead>
                              <tr>
                                <th>Sektion</th>
                                <th style={{ textAlign: "right" }}>ANO_CODE</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeAnoCodes.map((ac) => (
                                <tr key={`${ac.section}-${ac.value}`}>
                                  <td>{ac.section}</td>
                                  <td>{ac.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
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
