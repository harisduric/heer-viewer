import { useState, useEffect, useRef, useCallback } from "react";
import { Layout } from "../components/layout";
import {
  useGetSchemaLibrary,
  useGetCoordinates,
  useUpdateCoordinates,
  getGetCoordinatesQueryKey,
  getSchemaPage,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, RotateCcw } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// ── Types ─────────────────────────────────────────────────────────────────────

type SectionKey = "SE" | "KS" | "BO" | "DE";

interface CropValues {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

type AllCrops = Record<SectionKey, CropValues>;

interface Coord {
  x: number;
  y: number;
}

type DragInfo = {
  section: SectionKey;
  handle: string; // "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
  startMouseX: number;
  startMouseY: number;
  startCrop: CropValues;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTIONS: SectionKey[] = ["SE", "KS", "BO", "DE"];

const SECTION_META: Record<SectionKey, { border: string; bg: string; activeBg: string; label: string }> = {
  SE: { border: "#22C55E", bg: "rgba(34,197,94,0.06)",  activeBg: "rgba(34,197,94,0.18)",  label: "SE — Grün" },
  KS: { border: "#F97316", bg: "rgba(249,115,22,0.06)", activeBg: "rgba(249,115,22,0.18)", label: "KS — Orange" },
  BO: { border: "#3B82F6", bg: "rgba(59,130,246,0.06)", activeBg: "rgba(59,130,246,0.18)", label: "BO — Blau" },
  DE: { border: "#A855F7", bg: "rgba(168,85,247,0.06)", activeBg: "rgba(168,85,247,0.18)", label: "DE — Violett" },
};

const PDF_SCALE = 1.4;
const DEFAULT_COORD: Coord = { x: 100, y: 100 };
const LABEL_SCALE = 1.2;

const HANDLE_CURSORS: Record<string, string> = {
  nw: "nw-resize", n: "n-resize", ne: "ne-resize",
  w:  "w-resize",                 e:  "e-resize",
  sw: "sw-resize", s: "s-resize", se: "se-resize",
};

const PAGE_OPTIONS = [
  { value: "page1",    label: "Seite 1 — Übersicht" },
  { value: "page2",    label: "Seite 2 — Crop-Editor" },
  { value: "page3_KS", label: "Seite 3 — KS" },
  { value: "page3_SE", label: "Seite 3 — SE" },
  { value: "page3_DE", label: "Seite 3 — DE" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultCrops(pdfW: number, pdfH: number): AllCrops {
  const hw = Math.round(pdfW / 2);
  const hh = Math.round(pdfH / 2);
  return {
    SE: { cropX: 0,  cropY: 0,  cropW: hw,        cropH: hh         },
    KS: { cropX: hw, cropY: 0,  cropW: pdfW - hw,  cropH: hh         },
    BO: { cropX: 0,  cropY: hh, cropW: hw,         cropH: pdfH - hh  },
    DE: { cropX: hw, cropY: hh, cropW: pdfW - hw,  cropH: pdfH - hh  },
  };
}

function applyDrag(
  start: CropValues,
  handle: string,
  dxPdf: number,
  dyPdf: number,
  pdfW: number,
  pdfH: number,
): CropValues {
  const MIN = 20;
  let { cropX, cropY, cropW, cropH } = start;

  if (handle === "move") {
    cropX = Math.max(0, Math.min(pdfW - cropW, cropX + dxPdf));
    cropY = Math.max(0, Math.min(pdfH - cropH, cropY + dyPdf));
  } else {
    if (handle.includes("w")) {
      const nx = Math.min(cropX + dxPdf, cropX + cropW - MIN);
      cropW = cropW - (nx - cropX);
      cropX = nx;
    }
    if (handle.includes("e")) {
      cropW = Math.max(MIN, cropW + dxPdf);
    }
    if (handle.includes("n")) {
      const ny = Math.min(cropY + dyPdf, cropY + cropH - MIN);
      cropH = cropH - (ny - cropY);
      cropY = ny;
    }
    if (handle.includes("s")) {
      cropH = Math.max(MIN, cropH + dyPdf);
    }
  }

  return {
    cropX: Math.round(cropX),
    cropY: Math.round(cropY),
    cropW: Math.round(Math.max(MIN, cropW)),
    cropH: Math.round(Math.max(MIN, cropH)),
  };
}

// Resize handle dot positioned at one of 8 positions around a rect
function ResizeHandle({
  handle,
  color,
  onMouseDown,
}: {
  handle: string;
  color: string;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const size = 10;
  const half = size / 2;
  const style: React.CSSProperties = {
    position: "absolute",
    width: size,
    height: size,
    background: color,
    border: "2px solid #fff",
    borderRadius: 2,
    cursor: HANDLE_CURSORS[handle] ?? "pointer",
    zIndex: 10,
    ...(handle.includes("n") ? { top: -half } : handle.includes("s") ? { bottom: -half } : { top: "50%", marginTop: -half }),
    ...(handle.includes("w") ? { left: -half } : handle.includes("e") ? { right: -half } : { left: "50%", marginLeft: -half }),
  };
  return (
    <div
      style={style}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onMouseDown(e); }}
    />
  );
}

// One colored crop rectangle
function CropRect({
  sectionKey,
  crop,
  isActive,
  pdfScale,
  onActivate,
  onStartDrag,
}: {
  sectionKey: SectionKey;
  crop: CropValues;
  isActive: boolean;
  pdfScale: number;
  onActivate: (s: SectionKey) => void;
  onStartDrag: (e: React.MouseEvent, s: SectionKey, handle: string) => void;
}) {
  const meta = SECTION_META[sectionKey];
  return (
    <div
      style={{
        position: "absolute",
        left:   crop.cropX * pdfScale,
        top:    crop.cropY * pdfScale,
        width:  crop.cropW * pdfScale,
        height: crop.cropH * pdfScale,
        border: `2.5px solid ${meta.border}`,
        background: isActive ? meta.activeBg : meta.bg,
        cursor: "move",
        boxSizing: "border-box",
        zIndex: isActive ? 5 : 2,
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onActivate(sectionKey);
        onStartDrag(e, sectionKey, "move");
      }}
    >
      {/* Section label badge */}
      <div
        style={{
          position: "absolute",
          top: 4,
          left: 4,
          background: meta.border,
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1,
          padding: "2px 5px",
          borderRadius: 3,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {sectionKey}
      </div>
      {/* Resize handles */}
      {Object.keys(HANDLE_CURSORS).map((h) => (
        <ResizeHandle
          key={h}
          handle={h}
          color={meta.border}
          onMouseDown={(e) => {
            onActivate(sectionKey);
            onStartDrag(e, sectionKey, h);
          }}
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function KoordinatenPage() {
  const queryClient = useQueryClient();
  const { data: library = [] } = useGetSchemaLibrary();
  const [selectedSchema, setSelectedSchema] = useState("");
  const [selectedPage, setSelectedPage] = useState("page2");
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);

  // Page 2 — all 4 crop rects
  const [crops, setCrops] = useState<AllCrops>({
    SE: { cropX: 0,   cropY: 0,   cropW: 297, cropH: 421 },
    KS: { cropX: 297, cropY: 0,   cropW: 298, cropH: 421 },
    BO: { cropX: 0,   cropY: 421, cropW: 297, cropH: 421 },
    DE: { cropX: 297, cropY: 421, cropW: 298, cropH: 421 },
  });
  const [activeSection, setActiveSection] = useState<SectionKey>("SE");
  const [pdfDims, setPdfDims] = useState({ w: 595, h: 842 });
  const pdfDimsRef = useRef(pdfDims);
  useEffect(() => { pdfDimsRef.current = pdfDims; }, [pdfDims]);

  // Page 1 / Page 3 — label coords
  const [localCoords, setLocalCoords] = useState<Record<string, Coord>>({});

  const [saved, setSaved] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragInfo | null>(null);

  const pageNum = selectedPage === "page1" ? 1 : selectedPage === "page2" ? 2 : 3;
  const isPage2 = selectedPage === "page2";

  const { data: coordData, isLoading: coordLoading } = useGetCoordinates(selectedSchema, {
    query: { enabled: !!selectedSchema, queryKey: getGetCoordinatesQueryKey(selectedSchema) },
  });
  const updateCoords = useUpdateCoordinates();

  // Fetch PDF
  useEffect(() => {
    if (!selectedSchema) return;
    let cancelled = false;
    getSchemaPage(selectedSchema, pageNum)
      .then(async (blob) => {
        if (cancelled) return;
        setPdfData(new Uint8Array(await blob.arrayBuffer()));
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [selectedSchema, pageNum]);

  // Render PDF onto canvas
  useEffect(() => {
    if (!pdfData || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        const page = await pdf.getPage(1);
        // Capture natural dimensions (at scale 1.0)
        const vpNatural = page.getViewport({ scale: 1.0 });
        if (!cancelled) setPdfDims({ w: vpNatural.width, h: vpNatural.height });
        const vp = page.getViewport({ scale: isPage2 ? PDF_SCALE : LABEL_SCALE });
        const canvas = canvasRef.current!;
        canvas.width  = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfData, isPage2]);

  // Load coords / crops from DB when schema or page changes
  useEffect(() => {
    if (!coordData) return;
    const cd = coordData as Record<string, unknown>;

    if (isPage2) {
      const cropMap = (cd["page2_crops"] ?? {}) as Record<string, CropValues>;
      const { w, h } = pdfDimsRef.current;
      const defaults = defaultCrops(w, h);
      setCrops({
        SE: cropMap["SE"] ?? defaults.SE,
        KS: cropMap["KS"] ?? defaults.KS,
        BO: cropMap["BO"] ?? defaults.BO,
        DE: cropMap["DE"] ?? defaults.DE,
      });
    } else if (selectedPage === "page1") {
      setLocalCoords((cd["page1"] ?? {}) as Record<string, Coord>);
    } else if (selectedPage.startsWith("page3_")) {
      const sec = selectedPage.split("_")[1]!;
      const p3 = (cd["page3"] ?? {}) as Record<string, unknown>;
      const secData = (p3[sec] ?? {}) as Record<string, unknown>;
      setLocalCoords(
        Object.fromEntries(
          Object.entries(secData).map(([k, v]) => {
            const c = v as Record<string, number>;
            return [k, { x: c["cropX"] ?? 100, y: c["cropY"] ?? 100 }];
          })
        )
      );
    }
  }, [coordData, selectedPage, isPage2]);

  // Global mousemove / mouseup for crop dragging
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const scale = isPage2 ? PDF_SCALE : LABEL_SCALE;
      const dxPdf = (e.clientX - rect.left - dragRef.current.startMouseX) / scale;
      const dyPdf = (e.clientY - rect.top  - dragRef.current.startMouseY) / scale;
      const { w, h } = pdfDimsRef.current;
      const newCrop = applyDrag(dragRef.current.startCrop, dragRef.current.handle, dxPdf, dyPdf, w, h);
      setCrops((prev) => ({ ...prev, [dragRef.current!.section]: newCrop }));
    };
    const onUp = () => { dragRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isPage2]);

  const handleStartDrag = useCallback(
    (e: React.MouseEvent, section: SectionKey, handle: string) => {
      if (!overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      dragRef.current = {
        section,
        handle,
        startMouseX: e.clientX - rect.left,
        startMouseY: e.clientY - rect.top,
        startCrop: { ...crops[section] },
      };
    },
    [crops]
  );

  // Label drag (page 1 / page 3)
  const draggingLabel = useRef<string | null>(null);
  const handleLabelMouseDown = useCallback((e: React.MouseEvent, label: string) => {
    e.preventDefault();
    draggingLabel.current = label;
  }, []);
  const handleLabelMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingLabel.current || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / LABEL_SCALE);
    const y = Math.round((e.clientY - rect.top)  / LABEL_SCALE);
    setLocalCoords((prev) => ({ ...prev, [draggingLabel.current!]: { x, y } }));
  }, []);
  const handleLabelMouseUp = useCallback(() => { draggingLabel.current = null; }, []);

  const handleSave = async () => {
    if (!selectedSchema || !coordData) return;
    const cd = JSON.parse(JSON.stringify(coordData)) as Record<string, unknown>;

    if (isPage2) {
      cd["page2_crops"] = crops;
    } else if (selectedPage === "page1") {
      cd["page1"] = localCoords;
    } else if (selectedPage.startsWith("page3_")) {
      const sec = selectedPage.split("_")[1]!;
      const p3 = (cd["page3"] ?? {}) as Record<string, unknown>;
      const existing = (p3[sec] ?? {}) as Record<string, Record<string, number>>;
      const updated: Record<string, unknown> = {};
      for (const [k, coord] of Object.entries(localCoords)) {
        const prev = existing[k];
        updated[k] = { cropX: coord.x, cropY: coord.y, cropW: prev?.["cropW"] ?? 200, cropH: prev?.["cropH"] ?? 200 };
      }
      p3[sec] = updated;
      cd["page3"] = p3;
    }

    await updateCoords.mutateAsync({ name: selectedSchema, data: cd });
    queryClient.invalidateQueries({ queryKey: getGetCoordinatesQueryKey(selectedSchema) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    if (isPage2) {
      const { w, h } = pdfDimsRef.current;
      setCrops(defaultCrops(w, h));
    } else {
      setLocalCoords((prev) =>
        Object.fromEntries(Object.keys(prev).map((k) => [k, DEFAULT_COORD]))
      );
    }
  };

  const schemaLoaded = library.find((s) => s.name === selectedSchema);
  const hasPdf = !!schemaLoaded?.object_path;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-[#2D3748] tracking-tight mb-6">Koordinaten-Editor</h1>

        {/* Controls bar */}
        <div className="flex gap-4 mb-4 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#718096] uppercase tracking-wider">Schema</label>
            <select
              className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white text-[#2D3748] min-w-[220px]"
              value={selectedSchema}
              onChange={(e) => setSelectedSchema(e.target.value)}
            >
              <option value="">— Schema auswählen —</option>
              {library.filter((s) => s.status === "loaded").map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#718096] uppercase tracking-wider">Seite</label>
            <select
              className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white text-[#2D3748] min-w-[220px]"
              value={selectedPage}
              onChange={(e) => setSelectedPage(e.target.value)}
            >
              {PAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {selectedSchema && (
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={updateCoords.isPending} size="sm">
                {updateCoords.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                {saved ? "Gespeichert ✓" : "Speichern"}
              </Button>
              <Button variant="outline" onClick={handleReset} size="sm">
                <RotateCcw className="w-4 h-4 mr-1" /> Reset
              </Button>
            </div>
          )}
        </div>

        {/* Numeric fields for active crop section (page 2 only) */}
        {isPage2 && selectedSchema && hasPdf && (
          <div className="mb-4 bg-white rounded-xl border border-[#E2E8F0] p-4">
            {/* Section tabs */}
            <div className="flex gap-2 mb-3">
              {SECTIONS.map((s) => {
                const meta = SECTION_META[s];
                return (
                  <button
                    key={s}
                    onClick={() => setActiveSection(s)}
                    style={{
                      borderColor: meta.border,
                      background: activeSection === s ? meta.border : "white",
                      color: activeSection === s ? "#fff" : meta.border,
                    }}
                    className="px-3 py-1 rounded-md text-xs font-bold border-2 transition-colors"
                  >
                    {s}
                  </button>
                );
              })}
              <span className="ml-auto text-[11px] text-[#A0AEC0] self-center">
                Klicken zum Aktivieren · Ziehen zum Verschieben / Skalieren
              </span>
            </div>
            {/* Numeric inputs for selected section */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(["cropX", "cropY", "cropW", "cropH"] as const).map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#718096] uppercase">
                    {field === "cropX" ? "X (links)" : field === "cropY" ? "Y (oben)" : field === "cropW" ? "Breite" : "Höhe"}
                  </span>
                  <input
                    type="number"
                    min={0}
                    className="border border-[#E2E8F0] rounded px-2 py-1.5 text-sm font-mono bg-white text-[#2D3748] w-full"
                    value={crops[activeSection][field]}
                    onChange={(e) =>
                      setCrops((prev) => ({
                        ...prev,
                        [activeSection]: { ...prev[activeSection], [field]: Number(e.target.value) },
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <p className="text-[11px] text-[#A0AEC0] mt-2">
              Werte in PDF-Punkten (bei Zoom 1.0) · {pdfDims.w} × {pdfDims.h} pt
            </p>
          </div>
        )}

        {/* Empty states */}
        {!selectedSchema ? (
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-12 text-center text-[#718096] text-sm">
            Bitte wählen Sie ein Schema aus, um Koordinaten zu bearbeiten.
          </div>
        ) : !hasPdf ? (
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-12 text-center text-[#718096] text-sm">
            Für dieses Schema wurde noch kein PDF hochgeladen.
          </div>
        ) : coordLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#B8CC5A]" />
          </div>
        ) : (
          /* Canvas + overlay */
          <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
            <div
              ref={overlayRef}
              className="relative select-none overflow-auto"
              style={{ cursor: isPage2 ? "default" : "crosshair" }}
              onMouseMove={!isPage2 ? handleLabelMouseMove : undefined}
              onMouseUp={!isPage2 ? handleLabelMouseUp : undefined}
              onMouseLeave={!isPage2 ? handleLabelMouseUp : undefined}
            >
              <canvas ref={canvasRef} className="block" />

              {/* Page 2: 4 crop rectangles */}
              {isPage2 &&
                SECTIONS.map((s) => (
                  <CropRect
                    key={s}
                    sectionKey={s}
                    crop={crops[s]}
                    isActive={activeSection === s}
                    pdfScale={PDF_SCALE}
                    onActivate={setActiveSection}
                    onStartDrag={handleStartDrag}
                  />
                ))}

              {/* Page 1 / Page 3: draggable label dots */}
              {!isPage2 &&
                Object.entries(localCoords).map(([label, coord]) => (
                  <div
                    key={label}
                    className="absolute flex items-center gap-1 cursor-grab active:cursor-grabbing"
                    style={{
                      left: coord.x * LABEL_SCALE,
                      top:  coord.y * LABEL_SCALE,
                      transform: "translate(-50%, -50%)",
                    }}
                    onMouseDown={(e) => handleLabelMouseDown(e, label)}
                  >
                    <div className="w-3 h-3 rounded-full bg-[#B8CC5A] border-2 border-white shadow-md" />
                    <span className="text-[10px] font-bold bg-white/90 text-[#4A5568] px-1 rounded shadow-sm whitespace-nowrap">
                      {label}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
