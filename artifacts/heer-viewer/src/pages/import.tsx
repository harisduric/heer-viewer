import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useDropzone } from "react-dropzone";
import { useAppStore } from "../store";
import { Layout } from "../components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { UploadCloud, AlertCircle, Loader2 } from "lucide-react";
import type { ParsedExecution } from "@workspace/api-client-react";
import { useGetSchemaLibrary } from "@workspace/api-client-react";

export default function ImportPage() {
  const [, setLocation] = useLocation();
  const setParsedExecution = useAppStore((s) => s.setParsedExecution);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: library = [] } = useGetSchemaLibrary();
  const loadedCount = library.filter((s) => s.status === "loaded").length;
  const missingCount = library.filter((s) => s.status === "missing").length;

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      const file = acceptedFiles[0];

      setUploading(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/upload-execution", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? "Upload fehlgeschlagen");
        }
        const parsed = (await res.json()) as ParsedExecution;
        setParsedExecution(parsed);
        if (parsed.matchedSchema) {
          setLocation("/viewer");
        } else {
          setError(
            `Keine passende Schemazeichnung gefunden für "${file.name}"`
          );
        }
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Fehler beim Verarbeiten der Datei."
        );
      } finally {
        setUploading(false);
      }
    },
    [setParsedExecution, setLocation]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
  });

  return (
    <Layout>
      <div className="max-w-2xl mx-auto mt-8 flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-[#2D3748] tracking-tight">
          Ausführungsbeschreibung Importieren
        </h1>

        <Card className="border-[#E2E8F0] shadow-sm">
          <CardContent className="pt-6">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-colors
                ${isDragActive
                  ? "border-[#B8CC5A] border-solid bg-[#C8D882]"
                  : "border-[#B8CC5A] bg-[#EEF3C7] hover:bg-[#E5EDAA]"
                }`}
            >
              <input {...getInputProps()} />
              {uploading ? (
                <>
                  <Loader2 className="w-12 h-12 text-[#4A5568] animate-spin mb-4" />
                  <p className="text-[#4A5568] font-medium text-lg">
                    Wird verarbeitet...
                  </p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mb-4 shadow-sm">
                    <UploadCloud className="w-8 h-8 text-[#B8CC5A]" />
                  </div>
                  <p className="text-[#4A5568] font-bold text-lg mb-1">
                    PDF hier ablegen oder klicken
                  </p>
                  <p className="text-[#4A5568]/70 text-sm">
                    Laden Sie das Ausführungsbeschreibungs-PDF hoch, um die
                    Dimensionen zu prüfen.
                  </p>
                </>
              )}
            </div>

            {error && (
              <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-sm text-[#718096] font-medium flex items-center justify-between px-2">
          <span>Bibliothek: 17 Schemazeichnungen</span>
          <span>
            {loadedCount} geladen, {missingCount} fehlend
          </span>
        </div>
      </div>
    </Layout>
  );
}
