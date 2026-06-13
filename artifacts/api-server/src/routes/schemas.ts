import { Router } from "express";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import { db } from "@workspace/db";
import { schemasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { uploadSchemaPdf, streamSchemaPdf, deleteSchemaPdf } from "../lib/gcsStorage";
import { detectLabelsFromPdf } from "../lib/detectLabels";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/schema-library", async (_req, res): Promise<void> => {
  const rows = await db.select().from(schemasTable).orderBy(schemasTable.name);
  res.json(rows);
});

router.get(
  "/schema/:name/page/:num",
  async (req, res): Promise<void> => {
    const name = req.params["name"] as string;
    const pageNum = parseInt(req.params["num"] as string, 10);

    if (isNaN(pageNum) || pageNum < 1 || pageNum > 10) {
      res.status(400).json({ error: "Invalid page number (must be 1–10)" });
      return;
    }

    const [row] = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.name, name))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Schema slot not found" });
      return;
    }

    if (!row.object_path) {
      res.status(404).json({ error: "No PDF uploaded for this schema" });
      return;
    }

    let stream;
    try {
      stream = await streamSchemaPdf(row.object_path);
    } catch (err) {
      req.log.error({ err }, "Failed to stream PDF from GCS");
      res.status(500).json({ error: "Failed to retrieve PDF" });
      return;
    }

    if (!stream) {
      res.status(404).json({ error: "PDF not found in storage" });
      return;
    }

    // Buffer the full PDF so pdf-lib can extract the requested page
    const chunks: Buffer[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        stream!.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream!.on("end", resolve);
        stream!.on("error", reject);
      });
    } catch (err) {
      req.log.error({ err }, "Error buffering PDF stream");
      if (!res.headersSent) res.status(500).json({ error: "Stream error" });
      return;
    }

    const fullBytes = Buffer.concat(chunks);

    let singlePageBytes: Uint8Array;
    try {
      const fullDoc = await PDFDocument.load(fullBytes);
      const totalPages = fullDoc.getPageCount();
      const zeroIdx = pageNum - 1;

      if (zeroIdx >= totalPages) {
        res
          .status(404)
          .json({ error: `Page ${pageNum} not found (PDF has ${totalPages} pages)` });
        return;
      }

      const newDoc = await PDFDocument.create();
      const [copied] = await newDoc.copyPages(fullDoc, [zeroIdx]);
      newDoc.addPage(copied);
      singlePageBytes = await newDoc.save();
    } catch (err) {
      req.log.error({ err }, "Failed to extract PDF page");
      res.status(500).json({ error: "Failed to extract page" });
      return;
    }

    req.log.info({ name, pageNum }, "Serving extracted PDF page");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", singlePageBytes.length);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(singlePageBytes));
  }
);

router.post(
  "/schema/:name/upload",
  upload.single("file"),
  async (req, res): Promise<void> => {
    const name = req.params["name"] as string;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const [row] = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.name, name))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Schema slot not found" });
      return;
    }

    // ── Step 1: delete old GCS file and wipe page2 coords (clean slate) ──
    if (row.object_path) {
      try {
        await deleteSchemaPdf(row.object_path);
        req.log.info({ name, oldPath: row.object_path }, "Deleted old PDF from GCS");
      } catch (err) {
        req.log.warn({ err }, "Failed to delete old PDF from GCS (non-fatal)");
      }
    }

    // Strip page2 coordinates so old detection data can never bleed through.
    const existingCoords = (row.coordinates ?? {}) as Record<string, unknown>;
    const { page2: _oldPage2, ...coordsWithoutPage2 } = existingCoords;
    await db
      .update(schemasTable)
      .set({ coordinates: Object.keys(coordsWithoutPage2).length ? coordsWithoutPage2 : null })
      .where(eq(schemasTable.name, name));

    // ── Step 2: upload new PDF ──
    let objectPath: string;
    try {
      objectPath = await uploadSchemaPdf(name, file.buffer);
    } catch (err) {
      req.log.error({ err }, "Failed to upload PDF to GCS");
      res.status(500).json({ error: "Failed to upload PDF" });
      return;
    }

    const [updated] = await db
      .update(schemasTable)
      .set({
        object_path: objectPath,
        uploaded_at: new Date(),
        status: "loaded",
      })
      .where(eq(schemasTable.name, name))
      .returning();

    // ── Step 3: auto-detect L-label positions from page 2 ──
    let detectedLabels: { summary: string; count: number } | null = null;
    try {
      const detection = await detectLabelsFromPdf(file.buffer);
      if (detection.count > 0) {
        const currentCoords = (updated.coordinates ?? {}) as Record<string, unknown>;
        const merged = { ...currentCoords, page2: detection.page2 };
        await db
          .update(schemasTable)
          .set({ coordinates: merged })
          .where(eq(schemasTable.name, name));

        detectedLabels = { summary: detection.summary, count: detection.count };
        req.log.info(
          { name, count: detection.count, summary: detection.summary },
          "Auto-detected label positions from page 2"
        );
      }
    } catch (err) {
      req.log.warn({ err }, "Label auto-detection failed (non-fatal)");
    }

    res.json({ ...updated, detected_labels: detectedLabels });
  }
);

router.patch(
  "/schema/:name/rename",
  async (req, res): Promise<void> => {
    const oldName = req.params["name"] as string;
    const body = req.body as { newName?: unknown };
    const newName =
      typeof body.newName === "string" ? body.newName.trim() : "";

    if (!newName) {
      res.status(400).json({ error: "newName is required" });
      return;
    }
    if (newName.length > 120) {
      res.status(400).json({ error: "newName too long (max 120 chars)" });
      return;
    }

    const [existing] = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.name, oldName))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Schema slot not found" });
      return;
    }

    if (newName === oldName) {
      res.json(existing);
      return;
    }

    const [conflict] = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.name, newName))
      .limit(1);

    if (conflict) {
      res.status(409).json({ error: "Name already in use" });
      return;
    }

    // Delete old PDF from GCS — the renamed slot is a clean slate.
    if (existing.object_path) {
      try {
        await deleteSchemaPdf(existing.object_path);
        req.log.info({ oldName, path: existing.object_path }, "Deleted old PDF from GCS on rename");
      } catch (err) {
        req.log.warn({ err }, "Failed to delete old PDF from GCS during rename (non-fatal)");
      }
    }

    // Reset everything: new name, wipe PDF ref, wipe coordinates, back to missing.
    const [updated] = await db
      .update(schemasTable)
      .set({
        name: newName,
        object_path: null,
        uploaded_at: null,
        status: "missing",
        coordinates: null,
      })
      .where(eq(schemasTable.name, oldName))
      .returning();

    req.log.info({ oldName, newName }, "Schema slot renamed and reset");
    res.json(updated);
  }
);

export default router;
