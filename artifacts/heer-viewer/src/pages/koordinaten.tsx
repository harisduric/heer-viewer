import { useState, useEffect, useRef, useCallback } from "react";
import { Layout } from "../components/layout";
import {
  useGetSchemaLibrary,
  useGetCoordinates,
  useUpdateCoordinates,
  getGetCoordinatesQueryKey,
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
  { value: "page1", label: "Seite 1 — Übersicht" },
  { value: "page2", label: "BO/SE/KS/DE — Crop-Editor" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultCrops(_pdfW: number, _pdfH: number): AllCrops {
  return {
    SE: { cropX: 0,   cropY: 20,  cropW: 230, cropH: 400 },
    KS: { cropX: 230, cropY: 20,  cropW: 160, cropH: 400 },
    BO: { cropX: 390, cropY: 20,  cropW: 205, cropH: 400 },
    DE: { cropX: 0,   cropY: 420, cropW: 390, cropH: 380 },
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
  const [previewPage, setPreviewPage] = useState(2);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);

  // Crop editor state (page2)
  const [crops, setCrops] = useState<AllCrops>({
    SE: { cropX: 0,   cropY: 20,  cropW: 230, cropH: 400 },
    KS: { cropX: 230, cropY: 20,  cropW: 160, cropH: 400 },
    BO: { cropX: 390, cropY: 20,  cropW: 205, cropH: 400 },
    DE: { cropX: 0,   cropY: 420, cropW: 390, cropH: 380 },
  });
  const [activeSection, setActiveSection] = useState<SectionKey>("SE");
  const [pdfDims, setPdfDims] = useState({ w: 595, h: 842 });
  const pdfDimsRef = useRef({ w: 595, h: 842 });

  // Label positioning state (page2_labels_* and page1/page3)
  const [localCoords, setLocalCoords] = useState<Record<string, Coord>>({});
  const [labelCrop, setLabelCrop] = useState<CropValues | null>(null);
  const labelCropRef = useRef<CropValues | null>(null);
  const [newLabelName, setNewLabelName] = useState("");

  // Container width tracked via ResizeObserver (PERMANENT FIX — never use window.innerWidth)
  const [containerWidth, setContainerWidth] = useState(800);
  const containerWidthRef = useRef(800);

  // Render scale (dynamic, fit-to-width)
  const [renderScale, setRenderScale] = useState(1.0);
  const renderScaleRef = useRef(1.0);

  const [hebegurtStartPage, setHebegurtStartPage] = useState<number | "">("");
  // Per-section PDF page number (1-indexed). Defaults to 2 (backward compat).
  const [cropPages, setCropPages] = useState<Record<SectionKey, number>>({ SE: 2, KS: 2, BO: 2, DE: 2 });
  // Per-section enabled flag. Defaults to true (backward compat — existing schemas show all sections).
  const [cropEnabled, setCropEnabled] = useState<Record<SectionKey, boolean>>({ SE: true, KS: true, BO: true, DE: true });
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
  // When in crop editor, the preview page is controlled explicitly by previewPage
  // (no longer auto-derived from activeSection — tab clicks must not trigger a fetch).
  // When editing labels for a section, show that section's configured page.
  const cropPage      = isPage2
    ? previewPage
    : isPage2Labels
    ? (cropPages[labelSection ?? "SE"] ?? 2)
    : 2;
  const pageNum       = selectedPage === "page1" ? 1 : cropPage;
  const isLabelMode   = !isPage2; // page1, page2_labels_* all use label-dot editing

  const { data: coordData, isLoading: coordLoading } = useGetCoordinates(selectedSchema, {
    query: { enabled: !!selectedSchema, queryKey: getGetCoordinatesQueryKey(selectedSchema) },
  });
  const updateCoords = useUpdateCoordinates();

  // Sync refs
  useEffect(() => { pdfDimsRef.current = pdfDims; }, [pdfDims]);
  useEffect(() => { renderScaleRef.current = renderScale; }, [renderScale]);
  useEffect(() => { labelCropRef.current = labelCrop; }, [labelCrop]);
  useEffect(() => { containerWidthRef.current = containerWidth; }, [containerWidth]);

  // PERMANENT FIX: ResizeObserver on container ref — never use window.innerWidth
  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      setContainerWidth(Math.max(200, w));
      containerWidthRef.current = Math.max(200, w);
    });
    ro.observe(wrapperRef.current);
    // Set initial value immediately
    setContainerWidth(Math.max(200, wrapperRef.current.clientWidth));
    containerWidthRef.current = Math.max(200, wrapperRef.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  // ── Fetch PDF ──────────────────────────────────────────────────────────────
  // PERMANENT FIX: always append ?t=Date.now() to bust browser PDF cache

  useEffect(() => {
    if (!selectedSchema) return;
    let cancelled = false;
    // Capture the page we intend to fetch so the .then() callback can verify
    // it is still the current page before committing to setPdfData.
    const intendedPage = pageNum;
    console.log(`[FETCH] effect fires — schema=${selectedSchema} pageNum=${intendedPage}`);
    fetch(`/api/schema/${encodeURIComponent(selectedSchema)}/page/${intendedPage}?t=${Date.now()}`)
      .then(async (r) => {
        console.log(`[FETCH] response ok=${r.ok} status=${r.status} cancelled=${cancelled} for page=${intendedPage}`);
        if (!r.ok || cancelled) return;
        const blob = await r.blob();
        if (!cancelled) {
          const arr = new Uint8Array(await blob.arrayBuffer());
          console.log(`[FETCH] calling setPdfData byteLength=${arr.byteLength} for page=${intendedPage}`);
          setPdfData(arr);
        }
      })
      .catch(console.error);
    return () => { cancelled = true; };
  // NOTE: activeSection intentionally omitted — tab clicks must NOT trigger a PDF fetch.
  // The page to display is driven solely by previewPage (via pageNum).
  }, [selectedSchema, pageNum]);

  // ── Render PDF canvas ──────────────────────────────────────────────────────
  // FIX: pass pdfData.slice() to getDocument so pdfjs does NOT transfer/neuter
  // the original buffer. Without slice(), pdfjs transfers the ArrayBuffer to its
  // worker thread, setting pdfData.byteLength=0 in React state — every subsequent
  // render then silently fails with an empty {} error.
  // FIX: check `cancelled` before touching the canvas (width/height reset clears
  // the canvas). Without this, a stale render IIFE can overwrite a fresh correct
  // render if it finishes last.

  useEffect(() => {
    if (!pdfData || !canvasRef.current) return;
    console.log(`[RENDER] effect fires — pdfData.byteLength=${pdfData.byteLength}`);
    // Safety net: if the buffer was neutered by an older code path, skip silently.
    if (pdfData.byteLength === 0) {
      console.warn('[RENDER] pdfData buffer is detached — skipping');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // slice() gives pdfjs its own independent copy — the original in React
        // state is never transferred/neutered.
        const pdf  = await pdfjsLib.getDocument({ data: pdfData.slice() }).promise;
        const page = await pdf.getPage(1);
        const vpNat = page.getViewport({ scale: 1.0 });
        if (cancelled) return;
        setPdfDims({ w: vpNat.width, h: vpNat.height });

        // PERMANENT FIX: scale derived from ResizeObserver containerWidth, not window.innerWidth
        const cw = containerWidthRef.current;
        let scale: number;

        if (isPage2) {
          // Fit full PDF page to container: scale = containerWidth / pdfNaturalWidth
          scale = Math.max(0.2, cw / vpNat.width);
        } else if (isPage2Labels && labelCropRef.current) {
          // Fit crop region width to container (Beschriftung views)
          scale = Math.max(0.2, cw / labelCropRef.current.cropW);
        } else {
          scale = LABEL_SCALE;
        }

        if (cancelled) return;
        setRenderScale(scale);
        renderScaleRef.current = scale;

        const vp = page.getViewport({ scale });
        // CRITICAL: check cancelled before resetting canvas — assigning canvas.width
        // clears the canvas and would erase a correct render from a newer IIFE.
        if (cancelled) return;
        const canvas = canvasRef.current!;
        canvas.width  = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d")!;
        console.log(`[RENDER] starting page.render scale=${scale.toFixed(3)}`);
        await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
        console.log('[RENDER] page.render complete ✓');
      } catch (e) {
        console.error('[RENDER] error:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfData, isPage2, isPage2Labels, labelCrop, containerWidth]);

  // ── Load coords / crops from DB ────────────────────────────────────────────

  useEffect(() => {
    if (!coordData) return;
    const cd = coordData as Record<string, unknown>;

    // Always load schema-level settings regardless of page view
    setHebegurtStartPage((cd["hebegurtStartPage"] as number | undefined) ?? "");

    if (isPage2) {
      const cropMap = (cd["page2_crops"] ?? {}) as Record<string, CropValues & { page?: number }>;
      const { w, h } = pdfDimsRef.current;
      const defs = defaultCrops(w, h);
      setCrops({
        SE: cropMap["SE"] ?? defs.SE,
        KS: cropMap["KS"] ?? defs.KS,
        BO: cropMap["BO"] ?? defs.BO,
        DE: cropMap["DE"] ?? defs.DE,
      });
      // Load per-section page numbers (default 2 for backward compat with old schemas)
      setCropPages({
        SE: cropMap["SE"]?.page ?? 2,
        KS: cropMap["KS"]?.page ?? 2,
        BO: cropMap["BO"]?.page ?? 2,
        DE: cropMap["DE"]?.page ?? 2,
      });
      // Load per-section enabled flags (default true for backward compat)
      setCropEnabled({
        SE: (cropMap["SE"] as { enabled?: boolean } | undefined)?.enabled !== false,
        KS: (cropMap["KS"] as { enabled?: boolean } | undefined)?.enabled !== false,
        BO: (cropMap["BO"] as { enabled?: boolean } | undefined)?.enabled !== false,
        DE: (cropMap["DE"] as { enabled?: boolean } | undefined)?.enabled !== false,
      });
    } else if (isPage2Labels && labelSection) {
      // Load this section's crop so we can render the zoomed view
      const cropMap = (cd["page2_crops"] ?? {}) as Record<string, CropValues & { page?: number }>;
      const crop = cropMap[labelSection] ?? null;
      setLabelCrop(crop);
      labelCropRef.current = crop;
      // Keep cropPages in sync for the label section's page
      const labelPage = cropMap[labelSection]?.page ?? 2;
      setCropPages((prev) => ({ ...prev, [labelSection]: labelPage }));
      // Load label positions for this section
      const p2Labels = (cd["page2"] ?? {}) as Record<string, unknown>;
      setLocalCoords((p2Labels[labelSection] ?? {}) as Record<string, Coord>);
    } else if (selectedPage === "page1") {
      setLabelCrop(null); labelCropRef.current = null;
      setLocalCoords((cd["page1"] ?? {}) as Record<string, Coord>);
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
      // Include the per-section page number and enabled flag alongside cropX/Y/W/H
      const cropsWithPages: Record<string, unknown> = {};
      for (const sec of SECTIONS) {
        cropsWithPages[sec] = { ...crops[sec], page: cropPages[sec] ?? 2, enabled: cropEnabled[sec] };
      }
      cd["page2_crops"] = cropsWithPages;
    } else if (isPage2Labels && labelSection) {
      const p2 = (cd["page2"] ?? {}) as Record<string, unknown>;
      p2[labelSection] = localCoords;
      cd["page2"] = p2;
    } else if (selectedPage === "page1") {
      cd["page1"] = localCoords;
    }

    // Preserve schema-level Hebegurt setting
    if (hebegurtStartPage !== "") {
      cd["hebegurtStartPage"] = Number(hebegurtStartPage);
    } else {
      delete cd["hebegurtStartPage"];
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

  const labelViewW = labelCrop ? labelCrop.cropW * renderScale : undefined;
  const labelViewH = labelCrop ? labelCrop.cropH * renderScale : undefined;
  const canvasOffsetX = labelCrop ? -labelCrop.cropX * renderScale : 0;
  const canvasOffsetY = labelCrop ? -labelCrop.cropY * renderScale : 0;
  const needsClip = isPage2Labels && !!labelCrop;

  return (
    <Layout>
      <div ref={wrapperRef} className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-[#2D3748] tracking-tight mb-6">Koordinaten-Editor</h1>

        {/* Controls bar */}
        <div className="flex gap-4 mb-4 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#718096] uppercase tracking-wider">Schema</label>
            <select
              className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white text-[#2D3748] min-w-[220px]"
              value={selectedSchema}
              onChange={(e) => { setSelectedSchema(e.target.value); setPreviewPage(2); }}
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
          {isPage2 && !!selectedSchema && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#718096] uppercase tracking-wider">Vorschau-Seite</label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                  className="w-8 h-9 rounded-md border border-[#E2E8F0] bg-white text-[#4A5568] hover:bg-[#F7FAFC] text-base font-bold flex items-center justify-center"
                  title="Vorherige Seite"
                >‹</button>
                <input
                  type="number"
                  min={1}
                  className="w-14 border border-[#E2E8F0] rounded-lg px-2 py-2 text-sm font-mono text-center bg-white text-[#2D3748]"
                  value={previewPage}
                  onChange={(e) => setPreviewPage(Math.max(1, Number(e.target.value) || 1))}
                />
                <button
                  onClick={() => setPreviewPage((p) => p + 1)}
                  className="w-8 h-9 rounded-md border border-[#E2E8F0] bg-white text-[#4A5568] hover:bg-[#F7FAFC] text-base font-bold flex items-center justify-center"
                  title="Nächste Seite"
                >›</button>
              </div>
            </div>
          )}
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

        {/* ── HEBEGURT SETTINGS card ── */}
        {selectedSchema && (
          <div className="mb-4 bg-white rounded-xl border border-[#E2E8F0] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#718096] mb-3">Hebegurt-Einstellungen</p>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-[#718096] uppercase">Startseite</span>
                <input
                  type="number"
                  min={1}
                  placeholder="–"
                  className="border border-[#E2E8F0] rounded px-2 py-1.5 text-sm font-mono bg-white text-[#2D3748] w-24"
                  value={hebegurtStartPage}
                  onChange={(e) =>
                    setHebegurtStartPage(e.target.value === "" ? "" : Number(e.target.value))
                  }
                />
              </label>
              <p className="text-xs text-[#718096] max-w-sm">
                Ab dieser Seite zeigt der Viewer alle PDF-Seiten als Hebegurt-Abschnitt an.
                Leer lassen = kein Hebegurt-Schritt.
              </p>
            </div>
          </div>
        )}

        {/* ── CROP EDITOR info panel ── */}
        {isPage2 && selectedSchema && hasPdf && (
          <div className="mb-4 bg-white rounded-xl border border-[#E2E8F0] p-4">
            <div className="flex gap-3 mb-3 flex-wrap items-start">
              {SECTIONS.map((s) => {
                const meta = SECTION_META[s];
                const isEnabled = cropEnabled[s];
                return (
                  <div key={s} className="flex flex-col items-center gap-1">
                    <button
                      onClick={() => setCropEnabled((prev) => ({ ...prev, [s]: !prev[s] }))}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded border transition-colors ${
                        isEnabled
                          ? "border-emerald-400 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                          : "border-[#CBD5E0] text-[#A0AEC0] bg-[#F7FAFC] hover:bg-[#EDF2F7]"
                      }`}
                    >
                      {isEnabled ? "Aktiv" : "Deaktiviert"}
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setActiveSection(s)}
                        style={{ borderColor: meta.border, background: activeSection === s ? meta.border : "white", color: activeSection === s ? "#fff" : meta.border }}
                        className="px-3 py-1 rounded-md text-xs font-bold border-2 transition-colors"
                      >
                        {s}
                      </button>
                      <input
                        type="number"
                        min={1}
                        title={`PDF-Seite für ${s}`}
                        className="w-11 border border-[#E2E8F0] rounded px-1 py-1 text-xs font-mono text-center bg-white text-[#2D3748]"
                        value={cropPages[s]}
                        onChange={(e) =>
                          setCropPages((prev) => ({ ...prev, [s]: Math.max(1, Number(e.target.value) || 1) }))
                        }
                      />
                    </div>
                  </div>
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
                    disabled={!cropEnabled[activeSection]}
                    className={`border border-[#E2E8F0] rounded px-2 py-1.5 text-sm font-mono bg-white text-[#2D3748] w-full${!cropEnabled[activeSection] ? " opacity-50 cursor-not-allowed" : ""}`}
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
        ) : isPage2Labels && !labelCrop ? (
          <div className="bg-white rounded-xl border border-amber-200 p-12 text-center">
            <p className="text-amber-700 font-medium text-sm">⚠ Bitte zuerst Crop-Editor verwenden</p>
            <p className="text-amber-600 text-xs mt-1">Definieren Sie den Crop-Bereich in „BO/SE/KS/DE — Crop-Editor" und speichern Sie.</p>
          </div>
        ) : (
          /* ── Canvas + overlay ── */
          <div
            className="bg-white rounded-xl border border-[#E2E8F0] overflow-x-hidden overflow-y-auto"
            style={{ maxHeight: "80vh" }}
          >
            <div
              ref={overlayRef}
              className="relative select-none"
              style={{
                cursor: isPage2 ? "default" : "crosshair",
                // PERMANENT FIX: clip BOTH width AND height to prevent adjacent sections bleeding in
                overflow: needsClip ? "hidden" : undefined,
                width: needsClip ? labelViewW : undefined,
                height: needsClip ? labelViewH : undefined,
              }}
              onMouseMove={isLabelMode ? handleLabelMouseMove : undefined}
              onMouseUp={isLabelMode ? handleLabelMouseUp : undefined}
              onMouseLeave={isLabelMode ? handleLabelMouseUp : undefined}
            >
              {/* PDF canvas — offset in crop-clip mode to show only the section area */}
              <canvas
                ref={canvasRef}
                style={
                  needsClip
                    ? { position: "absolute", left: canvasOffsetX, top: canvasOffsetY }
                    : { display: "block" }
                }
              />

              {/* Crop editor: colored rectangles for sections on the currently displayed page */}
              {isPage2 &&
                SECTIONS.filter((s) => cropEnabled[s] && cropPages[s] === previewPage).map((s) => (
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
                    : coord.x * renderScale;
                  const top = crop
                    ? (coord.y - crop.cropY) * renderScale
                    : coord.y * renderScale;
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
