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

interface Coord {
  x: number;
  y: number;
}

interface CropValues {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

const DEFAULT_COORD: Coord = { x: 100, y: 100 };
const SCALE = 1.2;

// Rough default crops for page 2 sections (A4 portrait at scale 1.0, fine-tune in editor)
// Layout: SE top-left, KS top-center, BO top-right, DE bottom-left
const DEFAULT_PAGE2_CROPS: Record<string, CropValues> = {
  SE: { cropX: 0,   cropY: 0,   cropW: 200, cropH: 420 },
  KS: { cropX: 200, cropY: 0,   cropW: 200, cropH: 420 },
  BO: { cropX: 400, cropY: 0,   cropW: 195, cropH: 420 },
  DE: { cropX: 0,   cropY: 420, cropW: 200, cropH: 422 },
};

const PAGE_OPTIONS = [
  { value: "page1",    label: "Seite 1 — Übersicht" },
  { value: "page2_BO", label: "Seite 2 — BO" },
  { value: "page2_SE", label: "Seite 2 — SE" },
  { value: "page2_KS", label: "Seite 2 — KS" },
  { value: "page2_DE", label: "Seite 2 — DE" },
  { value: "page3_KS", label: "Seite 3 — KS" },
  { value: "page3_SE", label: "Seite 3 — SE" },
  { value: "page3_DE", label: "Seite 3 — DE" },
];

export default function KoordinatenPage() {
  const queryClient = useQueryClient();
  const { data: library = [] } = useGetSchemaLibrary();
  const [selectedSchema, setSelectedSchema] = useState("");
  const [selectedPage, setSelectedPage] = useState("page1");
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [localCoords, setLocalCoords] = useState<Record<string, Coord>>({});
  const [localCrop, setLocalCrop] = useState<CropValues | null>(null);
  const [saved, setSaved] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingLabel = useRef<string | null>(null);

  const { data: coordData, isLoading: coordLoading } = useGetCoordinates(
    selectedSchema,
    {
      query: {
        enabled: !!selectedSchema,
        queryKey: getGetCoordinatesQueryKey(selectedSchema),
      },
    }
  );

  const updateCoords = useUpdateCoordinates();

  const pageNum = selectedPage === "page1" ? 1 : selectedPage.startsWith("page2") ? 2 : 3;
  const isPage2 = selectedPage.startsWith("page2_");

  // Fetch the PDF when schema or page changes
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

  // Load coords and crops from DB
  useEffect(() => {
    if (!coordData) return;
    const cd = coordData as Record<string, unknown>;
    let section: Record<string, Coord> = {};

    if (selectedPage === "page1") {
      section = (cd["page1"] ?? {}) as Record<string, Coord>;
      setLocalCrop(null);
    } else if (isPage2) {
      const sec = selectedPage.split("_")[1]!;
      const p2 = (cd["page2"] ?? {}) as Record<string, unknown>;
      section = (p2[sec] ?? {}) as Record<string, Coord>;

      // Load crop for this page2 section
      const cropMap = (cd["page2_crops"] ?? {}) as Record<string, CropValues>;
      setLocalCrop(cropMap[sec] ?? DEFAULT_PAGE2_CROPS[sec] ?? { cropX: 0, cropY: 0, cropW: 300, cropH: 400 });
    } else if (selectedPage.startsWith("page3_")) {
      const sec = selectedPage.split("_")[1]!;
      const p3 = (cd["page3"] ?? {}) as Record<string, unknown>;
      const secData = (p3[sec] ?? {}) as Record<string, unknown>;
      section = Object.fromEntries(
        Object.entries(secData).map(([k, v]) => {
          const crop = v as Record<string, number>;
          return [k, { x: crop["cropX"] ?? 100, y: crop["cropY"] ?? 100 }];
        })
      );
      setLocalCrop(null);
    }

    setLocalCoords(section);
  }, [coordData, selectedPage, isPage2]);

  // Render PDF canvas
  useEffect(() => {
    if (!pdfData || !canvasRef.current) return;
    (async () => {
      try {
        const task = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: SCALE });
        const canvas = canvasRef.current!;
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
      } catch (e) {
        console.error(e);
      }
    })();
  }, [pdfData]);

  const handleMouseDown = useCallback((e: React.MouseEvent, label: string) => {
    e.preventDefault();
    draggingLabel.current = label;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingLabel.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / SCALE);
    const y = Math.round((e.clientY - rect.top) / SCALE);
    setLocalCoords((prev) => ({
      ...prev,
      [draggingLabel.current!]: { x, y },
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    draggingLabel.current = null;
  }, []);

  const handleSave = async () => {
    if (!selectedSchema || !coordData) return;
    const cd = JSON.parse(JSON.stringify(coordData)) as Record<string, unknown>;

    if (selectedPage === "page1") {
      cd["page1"] = localCoords;
    } else if (isPage2) {
      const sec = selectedPage.split("_")[1]!;
      const p2 = (cd["page2"] ?? {}) as Record<string, unknown>;
      p2[sec] = localCoords;
      cd["page2"] = p2;

      // Also save the crop for this section
      if (localCrop) {
        const cropMap = (cd["page2_crops"] ?? {}) as Record<string, unknown>;
        cropMap[sec] = localCrop;
        cd["page2_crops"] = cropMap;
      }
    } else if (selectedPage.startsWith("page3_")) {
      const sec = selectedPage.split("_")[1]!;
      const p3 = (cd["page3"] ?? {}) as Record<string, unknown>;
      const existingSec = (p3[sec] ?? {}) as Record<string, Record<string, number>>;
      const updatedSec: Record<string, unknown> = {};
      for (const [k, coord] of Object.entries(localCoords)) {
        const prev = existingSec[k];
        updatedSec[k] = {
          cropX: coord.x,
          cropY: coord.y,
          cropW: prev?.["cropW"] ?? 200,
          cropH: prev?.["cropH"] ?? 200,
        };
      }
      p3[sec] = updatedSec;
      cd["page3"] = p3;
    }

    await updateCoords.mutateAsync({ name: selectedSchema, data: cd });
    queryClient.invalidateQueries({ queryKey: getGetCoordinatesQueryKey(selectedSchema) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    if (isPage2) {
      const sec = selectedPage.split("_")[1]!;
      setLocalCrop(DEFAULT_PAGE2_CROPS[sec] ?? { cropX: 0, cropY: 0, cropW: 300, cropH: 400 });
    }
    const reset = Object.fromEntries(
      Object.keys(localCoords).map((k) => [k, DEFAULT_COORD])
    );
    setLocalCoords(reset);
  };

  const schemaLoaded = library.find((s) => s.name === selectedSchema);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-[#2D3748] tracking-tight mb-6">
          Koordinaten-Editor
        </h1>

        <div className="flex gap-4 mb-6 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#718096] uppercase tracking-wider">Schema</label>
            <select
              className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white text-[#2D3748] min-w-[220px]"
              value={selectedSchema}
              onChange={(e) => setSelectedSchema(e.target.value)}
            >
              <option value="">— Schema auswählen —</option>
              {library
                .filter((s) => s.status === "loaded")
                .map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#718096] uppercase tracking-wider">Seite / Abschnitt</label>
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
            <div className="flex items-end gap-2">
              <Button onClick={handleSave} disabled={updateCoords.isPending} size="sm">
                {updateCoords.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <Save className="w-4 h-4 mr-1" />
                )}
                {saved ? "Gespeichert!" : "Speichern"}
              </Button>
              <Button variant="outline" onClick={handleReset} size="sm">
                <RotateCcw className="w-4 h-4 mr-1" /> Zurücksetzen
              </Button>
            </div>
          )}
        </div>

        {/* Crop editor for page2 sections */}
        {isPage2 && selectedSchema && localCrop && (
          <div className="mb-4 bg-white rounded-xl border border-[#E2E8F0] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#718096] mb-3">
              Ausschnitt (Crop) — {selectedPage.split("_")[1]} Sektion
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(["cropX", "cropY", "cropW", "cropH"] as const).map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[#718096] uppercase">
                    {field === "cropX" ? "X (links)" : field === "cropY" ? "Y (oben)" : field === "cropW" ? "Breite" : "Höhe"}
                  </span>
                  <input
                    type="number"
                    min={0}
                    className="border border-[#E2E8F0] rounded px-2 py-1.5 text-sm font-mono bg-white text-[#2D3748] w-full"
                    value={localCrop[field]}
                    onChange={(e) =>
                      setLocalCrop((prev) =>
                        prev ? { ...prev, [field]: Number(e.target.value) } : prev
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <p className="text-[11px] text-[#A0AEC0] mt-2">
              Koordinaten in PDF-Einheiten (Punkte bei Zoom 1.0). Der angezeigte Ausschnitt wird im Viewer skaliert.
            </p>
          </div>
        )}

        {!selectedSchema ? (
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-12 text-center text-[#718096] text-sm">
            Bitte wählen Sie ein Schema aus, um Koordinaten zu bearbeiten.
          </div>
        ) : !schemaLoaded?.object_path ? (
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-12 text-center text-[#718096] text-sm">
            Für dieses Schema wurde noch kein PDF hochgeladen.
          </div>
        ) : coordLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#B8CC5A]" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
            <div
              ref={containerRef}
              className="relative cursor-crosshair select-none overflow-auto"
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <canvas ref={canvasRef} className="block" />
              {Object.entries(localCoords).map(([label, coord]) => (
                <div
                  key={label}
                  className="absolute flex items-center gap-1 cursor-grab active:cursor-grabbing"
                  style={{
                    left: coord.x * SCALE,
                    top: coord.y * SCALE,
                    transform: "translate(-50%, -50%)",
                  }}
                  onMouseDown={(e) => handleMouseDown(e, label)}
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
