---
name: Per-section page model
description: Each BO/SE/KS/DE crop section can live on its own PDF page — the authoritative decision and invariants.
---

## Rule
Each BO/SE/KS/DE crop entry in `page2_crops` carries an optional `page` integer (1-indexed, default 2).
Schemas without this field fall back to page 2 everywhere (backward compat).

**Why:** Some schema PDFs place sections on different pages. The old "Seite 3 — KS/SE/DE" dropdown was a dead legacy; per-section page numbers replace it cleanly.

## Invariants to maintain
- The viewer, the Koordinaten editor, and detectLabelsFromPdf must all read the same `page2_crops[sec].page ?? 2` value — never use a hardcoded `2` for steps 1-4.
- `detectLabelsFromPdf` must scan only the pages actually referenced by the cropMap and restrict L-label assignment to sections on the same page as each text item.
- Saving in the Koordinaten crop editor must write `page: cropPages[sec]` into each section's crop entry so the value persists.
- `isPage3` no longer exists; the old "Seite 3 — KS/SE/DE" tab entries are permanently removed.
