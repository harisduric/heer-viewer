import { Router } from "express";
import multer from "multer";
import { createRequire } from "module";
import {
  parseExecutionDescription,
  matchSchemaName,
} from "../lib/parsePdf";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (
  buffer: Buffer
) => Promise<{ text: string }>;

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post(
  "/upload-execution",
  upload.single("file"),
  async (req, res): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    let pdfText: string;
    try {
      const parsed = await pdfParse(file.buffer);
      pdfText = parsed.text;
    } catch (err) {
      req.log.error({ err }, "Failed to parse PDF");
      res.status(400).json({ error: "Failed to parse PDF" });
      return;
    }

    const parsedData = parseExecutionDescription(pdfText);
    const matchedSchema = matchSchemaName(file.originalname);

    res.json({ ...parsedData, matchedSchema });
  }
);

export default router;
