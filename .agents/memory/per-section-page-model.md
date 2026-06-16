---
name: Per-section page model
description: Each BO/SE/KS/DE crop section can live on its own PDF page; how it's stored, read, and detected.
---

## Rule
Each BO/SE/KS/DE crop entry in `page2_crops` carries an optional `page` integer (1-indexed).
Schemas without this field default to page 2 everywhere (backward compat).

## Data shape (stored in DB coordinates JSON)
```json
"page2_crops": {
  "SE": { "cropX": 0, "cropY": 20, "cropW": 230, "cropH": 400, "page": 2 },
  "KS": { "cropX": 230, "cropY": 20, "cropW": 160, "cropH": 400, "page": 3 }
}
```

## Where the field is read
- `viewer.tsx` — `sectionPage` useMemo reads `page2_crops[sKey].page ?? 2` before computing `pdfPageNum` for steps 1-4.
- `koordinaten.tsx` — `cropPages` state (Record<SectionKey,number>) is loaded from DB on open and saved back on Speichern. The `pageNum` for the PDF fetch is `cropPages[activeSection]` when in crop editor mode.
- `detectLabels.ts` — `CropRegion` interface has `page?: number`; `pagesToScan` is built from these values; label items carry `pageNum` and section assignment is restricted to sections on the same page.

## Why
The original model hard-coded page 2 for all BO/SE/KS/DE sections. Some schema PDFs have sections on different pages. The old "Seite 3 — KS/SE/DE" dropdown entries were a dead legacy approach; they are now removed in favour of per-section page numbers.

## How to apply
- When adding new koordinaten UI features, always read/write `cropPages` state (not a hardcoded 2).
- When calling `detectLabelsFromPdf`, pass the full `page2_crops` map including the `page` field so it scans the right pages.
- Never access `isPage3` — that variable no longer exists.
