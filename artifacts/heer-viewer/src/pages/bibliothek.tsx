import { useRef, useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "../components/layout";
import {
  useGetSchemaLibrary,
  getGetSchemaLibraryQueryKey,
} from "@workspace/api-client-react";
import type { SchemaSlot } from "@workspace/api-client-react";
import { Loader2, UploadCloud, Pencil, Check, X } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

type Msg = { text: string; kind: "success" | "info" };

function SchemaCard({ slot }: { slot: SchemaSlot }) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbVersion, setThumbVersion] = useState(0);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (slot.status !== "loaded" || !slot.object_path) return;
    setThumbLoading(true);
    // Cache-bust with thumbVersion so re-uploads always fetch fresh page data.
    const url = `/api/schema/${encodeURIComponent(slot.name)}/page/1${thumbVersion > 0 ? `?v=${thumbVersion}` : ""}`;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error("page fetch failed");
        const blob = await r.blob();
        const data = new Uint8Array(await blob.arrayBuffer());
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
  }, [slot.name, slot.status, slot.object_path, thumbVersion]);

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setMessages([]);
      setThumbUrl(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`/api/schema/${slot.name}/upload`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error("Upload failed");
        const result = await res.json() as {
          detected_labels?: { summary: string; count: number } | null;
        };
        const next: Msg[] = [
          { text: "Alte Daten gelöscht", kind: "success" },
          { text: "Neue Zeichnung gespeichert", kind: "success" },
        ];
        if (result.detected_labels?.count) {
          next.push({ text: "Labels automatisch erkannt", kind: "info" });
        }
        setMessages(next);
        // Bump version to force thumbnail re-fetch with cache-bust.
        setThumbVersion((v) => v + 1);
        queryClient.invalidateQueries({
          queryKey: getGetSchemaLibraryQueryKey(),
        });
      } catch (_err) {
        setMessages([{ text: "Fehler beim Hochladen", kind: "success" }]);
      } finally {
        setUploading(false);
      }
    },
    [slot.name, queryClient]
  );

  const handleRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === slot.name) {
      setIsRenaming(false);
      setRenameError(null);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/schema/${slot.name}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName: trimmed }),
      });
      if (res.status === 409) {
        setRenameError("Name bereits vergeben");
        return;
      }
      if (!res.ok) throw new Error("Rename failed");
      setIsRenaming(false);
      setRenameError(null);
      setMessages([{ text: `Umbenannt zu "${trimmed}"`, kind: "success" }]);
      queryClient.invalidateQueries({ queryKey: getGetSchemaLibraryQueryKey() });
    } catch (err) {
      console.error(err);
      setRenameError("Fehler beim Umbenennen");
    } finally {
      setRenaming(false);
    }
  }, [renameValue, slot.name, queryClient]);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
    setRenameValue("");
    setRenameError(null);
  }, []);

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
      className={`bg-white rounded-xl border p-4 flex flex-col gap-3 transition-all
        ${isRenaming ? "cursor-default" : "cursor-pointer"}
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
      onClick={() => !uploading && !isRenaming && inputRef.current?.click()}
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
        {isRenaming ? (
          /* ── Rename mode ── */
          <div
            className="flex flex-col gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") cancelRename();
                }}
                className="flex-1 min-w-0 text-xs border border-[#CBD5E0] rounded px-2 py-1 outline-none focus:border-[#B8CC5A] focus:ring-1 focus:ring-[#B8CC5A]/40"
                placeholder="Neuer Name…"
              />
              <button
                onClick={handleRename}
                disabled={renaming}
                className="p-1 rounded text-[#276749] hover:bg-[#C6F6D5] transition-colors disabled:opacity-50"
                title="Bestätigen"
              >
                {renaming ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={cancelRename}
                disabled={renaming}
                className="p-1 rounded text-[#E53E3E] hover:bg-[#FFF5F5] transition-colors disabled:opacity-50"
                title="Abbrechen"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {renameError && (
              <p className="text-[10px] text-[#E53E3E]">{renameError}</p>
            )}
          </div>
        ) : (
          /* ── Normal mode ── */
          <>
            <p className="font-semibold text-sm text-[#2D3748] break-all leading-tight">
              {slot.name}
            </p>
            {uploadDate && (
              <p className="text-xs text-[#718096]">{uploadDate}</p>
            )}

            {/* Action buttons */}
            <div
              className="flex gap-1.5 mt-1 flex-wrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                disabled={uploading}
                onClick={() => !uploading && inputRef.current?.click()}
                className="flex items-center gap-1 text-[10px] text-[#718096] border border-[#E2E8F0] rounded px-1.5 py-0.5 hover:border-[#CBD5E0] hover:text-[#4A5568] hover:bg-[#F7FAFC] transition-colors disabled:opacity-40"
              >
                <UploadCloud className="w-3 h-3 shrink-0" />
                Neu hochladen
              </button>
              <button
                onClick={() => {
                  setIsRenaming(true);
                  setRenameValue(slot.name);
                  setMessages([]);
                }}
                className="flex items-center gap-1 text-[10px] text-[#718096] border border-[#E2E8F0] rounded px-1.5 py-0.5 hover:border-[#CBD5E0] hover:text-[#4A5568] hover:bg-[#F7FAFC] transition-colors"
              >
                <Pencil className="w-3 h-3 shrink-0" />
                Umbenennen
              </button>
            </div>
          </>
        )}
      </div>

      {/* Badge + messages */}
      <div className="mt-auto flex flex-col gap-2">
        <span
          className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded w-fit
            ${
              slot.status === "loaded"
                ? "bg-[#C6F6D5] text-[#276749]"
                : "bg-[#FEFCBF] text-[#975A16]"
            }`}
        >
          {slot.status === "loaded" ? "Geladen" : "Fehlend"}
        </span>

        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-[10px] leading-snug rounded px-2 py-1.5 border font-medium
              ${m.kind === "info"
                ? "bg-[#EBF8FF] text-[#2B6CB0] border-[#BEE3F8]"
                : "bg-[#F0FFF4] text-[#276749] border-[#C6F6D5]"
              }`}
          >
            {m.text}
          </div>
        ))}
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
