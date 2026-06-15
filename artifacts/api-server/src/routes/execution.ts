import { Router } from "express";
import multer from "multer";
import { createRequire } from "module";
import {
  parseExecutionDescription,
  matchSchemaName,
} from "../lib/parsePdf";

const require = createRequire(import.meta.url);
// pdf-parse v1: module.exports = function(buffer, options) => Promise<{text}>
const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
  options?: { max?: number }
) => Promise<{ text: string; numpages: number }>;

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
    let pdfNumPages = 0;
    try {
      // max: 0 = no page limit — parse all pages
      const parsed = await pdfParse(file.buffer, { max: 0 });
      pdfText = parsed.text;
      pdfNumPages = parsed.numpages;
    } catch (err) {
      req.log.error({ err }, "Failed to parse PDF");
      res.status(400).json({ error: "Failed to parse PDF" });
      return;
    }

    // DEBUG: diagnose multi-page extraction
    req.log.info(
      {
        numpages: pdfNumPages,
        textLength: pdfText.length,
        containsL15: pdfText.includes("L15"),
        first200: pdfText.slice(0, 200),
        last200: pdfText.slice(-200),
      },
      "DEBUG pdf-parse extraction"
    );

    const parsedData = parseExecutionDescription(pdfText);

    // DEBUG: log the full DE section from parsed result
    req.log.info({ deSection: parsedData.sections.DE }, "DEBUG parsed DE section");

    const matchedSchema = matchSchemaName(file.originalname);

    req.log.info(
      { matchedSchema, filename: file.originalname },
      "Execution PDF parsed"
    );

    res.json({ ...parsedData, matchedSchema });
  }
);

export default router;
