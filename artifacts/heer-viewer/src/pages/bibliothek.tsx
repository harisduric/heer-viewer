import { useRef, useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "../components/layout";
import {
  useGetSchemaLibrary,
  getGetSchemaLibraryQueryKey,
} from "@workspace/api-client-react";
import type { SchemaSlot } from "@workspace/api-client-react";
import { Loader2, UploadCloud } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

function SchemaCard({ slot }: { slot: SchemaSlot }) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (slot.status !== "loaded" || !slot.object_path) return;
    setThumbLoading(true);
    fetch(`/api/schema/${slot.name}/pdf`)
      .then((r) => r.arrayBuffer())
      .then(async (ab) => {
        const data = new Uint8Array(ab);
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 0.25 });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
        setThumbUrl(canvas.toDataURL());
        setThumbLoading(false);
      })
      .catch(() => setThumbLoading(false));
  }, [slot.name, slot.status, slot.object_path]);

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`/api/schema/${slot.name}/upload`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error("Upload failed");
        queryClient.invalidateQueries({
          queryKey: getGetSchemaLibraryQueryKey(),
        });
      } catch (err) {
        console.error(err);
      } finally {
        setUploading(false);
      }
    },
    [slot.name, queryClient]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file?.type === "application/pdf") uploadFile(file);
    },
    [uploadFile]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const uploadDate = slot.uploaded_at
    ? new Date(slot.uploaded_at).toLocaleDateString("de-CH")
    : null;

  return (
    <div
      className={`bg-white rounded-xl border p-4 flex flex-col gap-3 cursor-pointer transition-all
        ${
          dragOver
            ? "border-[#B8CC5A] shadow-[0_4px_16px_rgba(184,204,90,0.3)]"
            : "border-[#E2E8F0] hover:border-[#B8CC5A] hover:shadow-[0_4px_16px_rgba(184,204,90,0.2)]"
        }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => !uploading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={onInputChange}
      />

      {/* Thumbnail */}
      <div className="h-32 bg-[#F7F8F3] rounded-lg flex items-center justify-center overflow-hidden relative">
        {uploading ? (
          <Loader2 className="w-6 h-6 animate-spin text-[#B8CC5A]" />
        ) : thumbLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-[#718096]" />
        ) : thumbUrl ? (
          <img
            src={thumbUrl}
            alt="Vorschau"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-[#718096]">
            <UploadCloud className="w-6 h-6" />
            <span className="text-xs">Kein Vorschaubild</span>
          </div>
        )}
        {dragOver && (
          <div className="absolute inset-0 bg-[#B8CC5A]/20 border-2 border-[#B8CC5A] rounded-lg flex items-center justify-center">
            <UploadCloud className="w-6 h-6 text-[#B8CC5A]" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-sm text-[#2D3748] break-all leading-tight">
          {slot.name}
        </p>
        {uploadDate && (
          <p className="text-xs text-[#718096]">{uploadDate}</p>
        )}
      </div>

      {/* Badge */}
      <div className="mt-auto">
        <span
          className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded
            ${
              slot.status === "loaded"
                ? "bg-[#C6F6D5] text-[#276749]"
                : "bg-[#FEFCBF] text-[#975A16]"
            }`}
        >
          {slot.status === "loaded" ? "Geladen" : "Fehlend"}
        </span>
      </div>
    </div>
  );
}

export default function BibliothekPage() {
  const { data: library = [], isLoading } = useGetSchemaLibrary();

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#2D3748] tracking-tight">
              Schemabibliothek
            </h1>
            <p className="text-sm text-[#718096] mt-1">
              {library.filter((s) => s.status === "loaded").length} von 17
              Schemazeichnungen geladen
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#B8CC5A]" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {library.map((slot) => (
              <SchemaCard key={slot.name} slot={slot} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
