import { Router } from "express";
import multer from "multer";
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
  "/schema/:name/pdf",
  async (req, res): Promise<void> => {
    const name = req.params["name"] as string;

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

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=3600");
    stream.pipe(res);
    stream.on("error", (err) => {
      req.log.error({ err }, "Stream error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream error" });
      }
    });
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
