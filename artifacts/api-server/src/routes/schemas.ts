import { Router } from "express";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import { db } from "@workspace/db";
import { schemasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { uploadSchemaPdf, streamSchemaPdf } from "../lib/gcsStorage";

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

    res.json(updated);
  }
);

export default router;
