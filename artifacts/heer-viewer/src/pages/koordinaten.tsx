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
import { Loader2, Save, RotateCcw, Plus, X } from "lucide-react";
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
  handle: string;
  startMouseX: number;
  startMouseY: number;
  startCrop: CropValues;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTIONS: SectionKey[] = ["SE", "KS", "BO", "DE"];

const SECTION_META: Record<SectionKey, { border: string; bg: string; activeBg: string }> = {
  SE: { border: "#22C55E", bg: "rgba(34,197,94,0.06)",  activeBg: "rgba(34,197,94,0.18)"  },
  KS: { border: "#F97316", bg: "rgba(249,115,22,0.06)", activeBg: "rgba(249,115,22,0.18)" },
  BO: { border: "#3B82F6", bg: "rgba(59,130,246,0.06)", activeBg: "rgba(59,130,246,0.18)" },
  DE: { border: "#A855F7", bg: "rgba(168,85,247,0.06)", activeBg: "rgba(168,85,247,0.18)" },
};

const LABEL_SCALE = 1.2;

const HANDLE_CURSORS: Record<string, string> = {
  nw: "nw-resize", n: "n-resize", ne: "ne-resize",
  w: "w-resize", e: "e-resize",
  sw: "sw-resize", s: "s-resize", se: "se-resize",
};

const PAGE_OPTIONS = [
  { value: "page1",          label: "Seite 1 — Übersicht" },
  { value: "page2",          label: "Seite 2 — Crop-Editor" },
  { value: "page2_labels_BO", label: "Seite 2 — BO Beschriftung" },
  { value: "page2_labels_SE", label: "Seite 2 — SE Beschriftung" },
  { value: "page2_labels_KS", label: "Seite 2 — KS Beschriftung" },
  { value: "page2_labels_DE", label: "Seite 2 — DE Beschriftung" },
  { value: "page3_KS",       label: "Seite 3 — KS" },
  { value: "page3_SE",       label: "Seite 3 — SE" },
  { value: "page3_DE",       label: "Seite 3 — DE" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultCrops(pdfW: number, pdfH: number): AllCrops {
  const hw = Math.round(pdfW / 2);
  const hh = Math.round(pdfH / 2);
  return {
    SE: { cropX: 0,  cropY: 0,  cropW: hw,       cropH: hh        },
    KS: { cropX: hw, cropY: 0,  cropW: pdfW - hw, cropH: hh        },
    BO: { cropX: 0,  cropY: hh, cropW: hw,        cropH: pdfH - hh },
    DE: { cropX: hw, cropY: hh, cropW: pdfW - hw, cropH: pdfH - hh },
  };
}

function applyDrag(
  start: CropValues, handle: string,
  dxPdf: number, dyPdf: number,
  pdfW: number, pdfH: number,
): CropValues {
  const MIN = 20;
  let { cropX, cropY, cropW, cropH } = start;
  if (handle === "move") {
    cropX = Math.max(0, Math.min(pdfW - cropW, cropX + dxPdf));
    cropY = Math.max(0, Math.min(pdfH - cropH, cropY + dyPdf));
  } else {
    if (handle.includes("w")) { const nx = Math.min(cropX + dxPdf, cropX + cropW - MIN); cropW -= nx - cropX; cropX = nx; }
    if (handle.includes("e")) { cropW = Math.max(MIN, cropW + dxPdf); }
    if (handle.includes("n")) { const ny = Math.min(cropY + dyPdf, cropY + cropH - MIN); cropH -= ny - cropY; cropY = ny; }
    if (handle.includes("s")) { cropH = Math.max(MIN, cropH + dyPdf); }
  }
  return { cropX: Math.round(cropX), cropY: Math.round(cropY), cropW: Math.round(Math.max(MIN, cropW)), cropH: Math.round(Math.max(MIN, cropH)) };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ResizeHandle({ handle, color, onMouseDown }: {
  handle: string; color: string; onMouseDown: (e: React.MouseEvent) => void;
}) {
  const half = 5;
  const style: React.CSSProperties = {
    position: "absolute", width: 10, height: 10,
    background: color, border: "2px solid #fff", borderRadius: 2,
    cursor: HANDLE_CURSORS[handle] ?? "pointer", zIndex: 10,
    ...(handle.includes("n") ? { top: -half } : handle.includes("s") ? { bottom: -half } : { top: "50%", marginTop: -half }),
    ...(handle.includes("w") ? { left: -half } : handle.includes("e") ? { right: -half } : { left: "50%", marginLeft: -half }),
  };
  return <div style={style} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onMouseDown(e); }} />;
}

function CropRect({ sectionKey, crop, isActive, pdfScale, onActivate, onStartDrag }: {
  sectionKey: SectionKey; crop: CropValues; isActive: boolean; pdfScale: number;
  onActivate: (s: SectionKey) => void;
  onStartDrag: (e: React.MouseEvent, s: SectionKey, handle: string) => void;
}) {
  const meta = SECTION_META[sectionKey];
  return (
    <div
      style={{
        position: "absolute",
        left: crop.cropX * pdfScale, top: crop.cropY * pdfScale,
        width: crop.cropW * pdfScale, height: crop.cropH * pdfScale,
        border: `2.5px solid ${meta.border}`,
        background: isActive ? meta.activeBg : meta.bg,
        cursor: "move", boxSizing: "border-box", zIndex: isActive ? 5 : 2,
      }}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onActivate(sectionKey); onStartDrag(e, sectionKey, "move"); }}
    >
      <div style={{ position: "absolute", top: 4, left: 4, background: meta.border, color: "#fff", fontSize: 11, fontWeight: 700, lineHeight: 1, padding: "2px 5px", borderRadius: 3, pointerEvents: "none", userSelect: "none" }}>
        {sectionKey}
      </div>
      {Object.keys(HANDLE_CURSORS).map((h) => (
        <ResizeHandle key={h} handle={h} color={meta.border}
          onMouseDown={(e) => { onActivate(sectionKey); onStartDrag(e, sectionKey, h); }} />
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

  // Crop editor state (page2)
  const [crops, setCrops] = useState<AllCrops>({
    SE: { cropX: 0,   cropY: 0,   cropW: 297, cropH: 421 },
    KS: { cropX: 297, cropY: 0,   cropW: 298, cropH: 421 },
    BO: { cropX: 0,   cropY: 421, cropW: 297, cropH: 421 },
    DE: { cropX: 297, cropY: 421, cropW: 298, cropH: 421 },
  });
  const [activeSection, setActiveSection] = useState<SectionKey>("SE");
  const [pdfDims, setPdfDims] = useState({ w: 595, h: 842 });
  const pdfDimsRef = useRef({ w: 595, h: 842 });

  // Label positioning state (page2_labels_* and page1/page3)
  const [localCoords, setLocalCoords] = useState<Record<string, Coord>>({});
  const [labelCrop, setLabelCrop] = useState<CropValues | null>(null);
  const labelCropRef = useRef<CropValues | null>(null);
  const [newLabelName, setNewLabelName] = useState("");

  // Render scale (dynamic, fit-to-width)
  const [renderScale, setRenderScale] = useState(1.0);
  const renderScaleRef = useRef(1.0);

  const [saved, setSaved] = useState(false);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef    = useRef<DragInfo | null>(null);
  const draggingLabel = useRef<string | null>(null);

  // Derived mode flags
  const isPage2       = selectedPage === "page2";
  const isPage2Labels = selectedPage.startsWith("page2_labels_");
  const labelSection  = isPage2Labels ? (selectedPage.split("_")[2] as SectionKey) : null;
  const pageNum       = selectedPage === "page1" ? 1 : (isPage2 || isPage2Labels) ? 2 : 3;
  const isLabelMode   = !isPage2; // page1, page2_labels_*, page3_* all use label-dot editing

  const { data: coordData, isLoading: coordLoading } = useGetCoordinates(selectedSchema, {
    query: { enabled: !!selectedSchema, queryKey: getGetCoordinatesQueryKey(selectedSchema) },
  });
  const updateCoords = useUpdateCoordinates();

  // Sync refs
  useEffect(() => { pdfDimsRef.current = pdfDims; }, [pdfDims]);
  useEffect(() => { renderScaleRef.current = renderScale; }, [renderScale]);
  useEffect(() => { labelCropRef.current = labelCrop; }, [labelCrop]);

  // ── Fetch PDF ──────────────────────────────────────────────────────────────

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

  // ── Render PDF canvas ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!pdfData || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const pdf  = await pdfjsLib.getDocument({ data: pdfData }).promise;
        const page = await pdf.getPage(1);
        const vpNat = page.getViewport({ scale: 1.0 });
        if (!cancelled) setPdfDims({ w: vpNat.width, h: vpNat.height });

        const availW = wrapperRef.current?.clientWidth ?? 800;
        let scale: number;

        if (isPage2) {
          // Fit full page width
          scale = Math.max(0.2, availW / vpNat.width);
        } else if (isPage2Labels && labelCropRef.current) {
          // Fit crop width — shows the section zoomed in
          scale = Math.max(0.2, availW / labelCropRef.current.cropW);
        } else {
          scale = LABEL_SCALE;
        }

        if (!cancelled) { setRenderScale(scale); renderScaleRef.current = scale; }

        const vp = page.getViewport({ scale });
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
  }, [pdfData, isPage2, isPage2Labels, labelCrop]);

  // ── Load coords / crops from DB ────────────────────────────────────────────

  useEffect(() => {
    if (!coordData) return;
    const cd = coordData as Record<string, unknown>;

    if (isPage2) {
      const cropMap = (cd["page2_crops"] ?? {}) as Record<string, CropValues>;
      const { w, h } = pdfDimsRef.current;
      const defs = defaultCrops(w, h);
      setCrops({
        SE: cropMap["SE"] ?? defs.SE,
        KS: cropMap["KS"] ?? defs.KS,
        BO: cropMap["BO"] ?? defs.BO,
        DE: cropMap["DE"] ?? defs.DE,
      });
    } else if (isPage2Labels && labelSection) {
      // Load this section's crop so we can render the zoomed view
      const cropMap = (cd["page2_crops"] ?? {}) as Record<string, CropValues>;
      const crop = cropMap[labelSection] ?? null;
      setLabelCrop(crop);
      labelCropRef.current = crop;
      // Load label positions for this section
      const p2Labels = (cd["page2"] ?? {}) as Record<string, unknown>;
      setLocalCoords((p2Labels[labelSection] ?? {}) as Record<string, Coord>);
    } else if (selectedPage === "page1") {
      setLabelCrop(null); labelCropRef.current = null;
      setLocalCoords((cd["page1"] ?? {}) as Record<string, Coord>);
    } else if (selectedPage.startsWith("page3_")) {
      setLabelCrop(null); labelCropRef.current = null;
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
  }, [coordData, selectedPage, isPage2, isPage2Labels, labelSection]);

  // ── Global mousemove/mouseup for CROP dragging ─────────────────────────────

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const scale = renderScaleRef.current;
      const dxPdf = (e.clientX - rect.left - dragRef.current.startMouseX) / scale;
      const dyPdf = (e.clientY - rect.top  - dragRef.current.startMouseY) / scale;
      const { w, h } = pdfDimsRef.current;
      const newCrop = applyDrag(dragRef.current.startCrop, dragRef.current.handle, dxPdf, dyPdf, w, h);
      const section = dragRef.current.section;
      setCrops((prev) => ({ ...prev, [section]: newCrop }));
    };
    const onUp = () => { dragRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  const handleStartCropDrag = useCallback(
    (e: React.MouseEvent, section: SectionKey, handle: string) => {
      if (!overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      dragRef.current = {
        section, handle,
        startMouseX: e.clientX - rect.left,
        startMouseY: e.clientY - rect.top,
        startCrop: { ...crops[section] },
      };
    },
    [crops]
  );

  // ── Label dot dragging ─────────────────────────────────────────────────────

  const handleLabelMouseDown = useCallback((e: React.MouseEvent, label: string) => {
    e.preventDefault();
    draggingLabel.current = label;
  }, []);

  const handleLabelMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingLabel.current || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const scale = renderScaleRef.current;
    const crop  = labelCropRef.current;

    let x: number, y: number;
    if (crop) {
      // Label mode: convert from crop-relative canvas coords to full-page PDF coords
      x = Math.round((e.clientX - rect.left) / scale + crop.cropX);
      y = Math.round((e.clientY - rect.top)  / scale + crop.cropY);
    } else {
      x = Math.round((e.clientX - rect.left) / scale);
      y = Math.round((e.clientY - rect.top)  / scale);
    }
    const lbl = draggingLabel.current;
    setLocalCoords((prev) => ({ ...prev, [lbl]: { x, y } }));
  }, []);

  const handleLabelMouseUp = useCallback(() => { draggingLabel.current = null; }, []);

  // ── Add / remove label ─────────────────────────────────────────────────────

  const handleAddLabel = useCallback(() => {
    const name = newLabelName.trim();
    if (!name || localCoords[name]) return;
    const crop = labelCropRef.current;
    const initX = crop ? Math.round(crop.cropX + crop.cropW / 2) : 100;
    const initY = crop ? Math.round(crop.cropY + crop.cropH / 2) : 100;
    setLocalCoords((prev) => ({ ...prev, [name]: { x: initX, y: initY } }));
    setNewLabelName("");
  }, [newLabelName, localCoords]);

  const handleRemoveLabel = useCallback((label: string) => {
    setLocalCoords((prev) => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!selectedSchema || !coordData) return;
    const cd = JSON.parse(JSON.stringify(coordData)) as Record<string, unknown>;

    if (isPage2) {
      cd["page2_crops"] = crops;
    } else if (isPage2Labels && labelSection) {
      const p2 = (cd["page2"] ?? {}) as Record<string, unknown>;
      p2[labelSection] = localCoords;
      cd["page2"] = p2;
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
      setCrops(defaultCrops(pdfDimsRef.current.w, pdfDimsRef.current.h));
    } else {
      setLocalCoords({});
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const schemaLoaded = library.find((s) => s.name === selectedSchema);
  const hasPdf = !!schemaLoaded?.object_path;

  const labelViewH = labelCrop ? labelCrop.cropH * renderScale : undefined;
  const canvasOffsetX = labelCrop ? -labelCrop.cropX * renderScale : 0;
  const canvasOffsetY = labelCrop ? -labelCrop.cropY * renderScale : 0;

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
              className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white text-[#2D3748] min-w-[240px]"
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

        {/* ── CROP EDITOR info panel ── */}
        {isPage2 && selectedSchema && hasPdf && (
          <div className="mb-4 bg-white rounded-xl border border-[#E2E8F0] p-4">
            <div className="flex gap-2 mb-3">
              {SECTIONS.map((s) => {
                const meta = SECTION_META[s];
                return (
                  <button
                    key={s}
                    onClick={() => setActiveSection(s)}
                    style={{ borderColor: meta.border, background: activeSection === s ? meta.border : "white", color: activeSection === s ? "#fff" : meta.border }}
                    className="px-3 py-1 rounded-md text-xs font-bold border-2 transition-colors"
                  >
                    {s}
                  </button>
                );
              })}
              <span className="ml-auto text-[11px] text-[#A0AEC0] self-center">
                Ziehen zum Verschieben / Ecken ziehen zum Skalieren
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(["cropX", "cropY", "cropW", "cropH"] as const).map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#718096] uppercase">
                    {field === "cropX" ? "X (links)" : field === "cropY" ? "Y (oben)" : field === "cropW" ? "Breite" : "Höhe"}
                  </span>
                  <input
                    type="number" min={0}
                    className="border border-[#E2E8F0] rounded px-2 py-1.5 text-sm font-mono bg-white text-[#2D3748] w-full"
                    value={crops[activeSection][field]}
                    onChange={(e) => setCrops((prev) => ({ ...prev, [activeSection]: { ...prev[activeSection], [field]: Number(e.target.value) } }))}
                  />
                </label>
              ))}
            </div>
            <p className="text-[11px] text-[#A0AEC0] mt-2">PDF-Punkte bei Zoom 1.0 · {pdfDims.w} × {pdfDims.h} pt</p>
          </div>
        )}

        {/* ── LABEL EDITOR info panel ── */}
        {isPage2Labels && selectedSchema && hasPdf && (
          <div className="mb-4 bg-white rounded-xl border border-[#E2E8F0] p-4">
            <div className="flex items-center gap-3 mb-3">
              {labelSection && (
                <span
                  className="px-3 py-1 rounded-md text-xs font-bold border-2"
                  style={{ borderColor: SECTION_META[labelSection].border, color: SECTION_META[labelSection].border }}
                >
                  {labelSection}
                </span>
              )}
              <span className="text-sm text-[#4A5568] font-medium">Beschriftungs-Positionen</span>
              {!labelCrop && (
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                  ⚠ Crop für diese Sektion noch nicht definiert
                </span>
              )}
              <span className="ml-auto text-[11px] text-[#A0AEC0]">Punkte ziehen zum Positionieren</span>
            </div>

            {/* Add label */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Name (z.B. L1)"
                className="border border-[#E2E8F0] rounded px-2 py-1.5 text-sm bg-white text-[#2D3748] w-32 font-mono"
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddLabel(); }}
              />
              <Button size="sm" variant="outline" onClick={handleAddLabel} disabled={!newLabelName.trim()}>
                <Plus className="w-4 h-4 mr-1" /> Hinzufügen
              </Button>
            </div>

            {/* Current labels */}
            {Object.keys(localCoords).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(localCoords).map(([label, coord]) => (
                  <div key={label} className="flex items-center gap-1 bg-[#F7FAFC] border border-[#E2E8F0] rounded px-2 py-1 text-xs font-mono">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#B8CC5A]" />
                    <span className="font-semibold text-[#2D3748]">{label}</span>
                    <span className="text-[#A0AEC0]">({coord.x}, {coord.y})</span>
                    <button
                      onClick={() => handleRemoveLabel(label)}
                      className="ml-1 text-[#A0AEC0] hover:text-red-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[#A0AEC0]">Noch keine Beschriftungen. Name eingeben und „Hinzufügen" klicken.</p>
            )}
          </div>
        )}

        {/* ── Empty states ── */}
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
          /* ── Canvas + overlay ── */
          <div
            ref={wrapperRef}
            className="bg-white rounded-xl border border-[#E2E8F0] overflow-x-hidden overflow-y-auto"
            style={{ maxHeight: "80vh" }}
          >
            <div
              ref={overlayRef}
              className="relative select-none"
              style={{
                cursor: isPage2 ? "default" : "crosshair",
                // For label mode: clip to the section's crop area
                overflow: isPage2Labels && labelCrop ? "hidden" : undefined,
                height: isPage2Labels && labelCrop ? labelViewH : undefined,
              }}
              onMouseMove={isLabelMode ? handleLabelMouseMove : undefined}
              onMouseUp={isLabelMode ? handleLabelMouseUp : undefined}
              onMouseLeave={isLabelMode ? handleLabelMouseUp : undefined}
            >
              {/* PDF canvas — offset in label mode to show only the crop area */}
              <canvas
                ref={canvasRef}
                style={
                  isPage2Labels && labelCrop
                    ? { position: "absolute", left: canvasOffsetX, top: canvasOffsetY }
                    : { display: "block" }
                }
              />

              {/* Page 2 crop editor: 4 colored rectangles */}
              {isPage2 &&
                SECTIONS.map((s) => (
                  <CropRect
                    key={s}
                    sectionKey={s}
                    crop={crops[s]}
                    isActive={activeSection === s}
                    pdfScale={renderScale}
                    onActivate={setActiveSection}
                    onStartDrag={handleStartCropDrag}
                  />
                ))}

              {/* Label mode: draggable label dots */}
              {isLabelMode &&
                Object.entries(localCoords).map(([label, coord]) => {
                  const crop = labelCropRef.current;
                  const left = crop
                    ? (coord.x - crop.cropX) * renderScale
                    : coord.x * (isPage2Labels ? renderScale : LABEL_SCALE);
                  const top = crop
                    ? (coord.y - crop.cropY) * renderScale
                    : coord.y * (isPage2Labels ? renderScale : LABEL_SCALE);
                  return (
                    <div
                      key={label}
                      className="absolute flex items-center gap-1 cursor-grab active:cursor-grabbing"
                      style={{ left, top, transform: "translate(-50%, -50%)" }}
                      onMouseDown={(e) => handleLabelMouseDown(e, label)}
                    >
                      <div className="w-3 h-3 rounded-full bg-[#B8CC5A] border-2 border-white shadow-md" />
                      <span className="text-[10px] font-bold bg-white/90 text-[#4A5568] px-1 rounded shadow-sm whitespace-nowrap">
                        {label}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
