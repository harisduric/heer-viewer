# PERMANENT TECHNICAL DECISIONS

## 1. PDF Canvas Scaling (Koordinaten Editor)
ALWAYS use ResizeObserver on the container div ref.
Scale = containerDiv.clientWidth / pageWidthInPoints
Never use window.innerWidth.
Re-render on resize.

## 2. PDF Cache Busting
ALWAYS append ?t=Date.now() to all PDF fetch URLs.
Reload PDF when schema selection changes.

## 3. Auto Label Detection
When a schema PDF is uploaded to Bibliothek:
- Use pdf-parse with pagerender hook on page 2
- Extract ALL text items with their X,Y coordinates
- Find section headers: BO, SE, KS, DE
- Find all labels matching /^L\d+$/ (L1-L20)
- Assign each label to nearest section header
- Save BOTH x AND y coordinates to database
- Also save rotation (degrees from atan2(t[1],t[0])) when non-zero
- This runs automatically on every upload
- No manual label positioning needed

## 4. Beschriftungs-Positionen Views
These views (BO/SE/KS/DE Beschriftung) are REMOVED
from the Koordinaten editor. They are not needed.
The Koordinaten editor only has:
- Seite 1 — Übersicht (global dimensions)
- Seite 2 — Crop-Editor (BO/SE/KS/DE regions)
- Seite 3 — KS/SE/DE (ANO_CODE crops)

## 5. Overlay Rendering in Viewer — VALUE NEXT TO LABEL (confirmed approach)
Dimension values are drawn NEXT TO their Lx anchor on the overlay canvas.
The original Lx text in the PDF is left completely untouched — no covering.

Scope: overlays are ONLY drawn for steps 1–4 (BO/SE/KS/DE).
Step 0 (Übersicht, page 1) renders the PDF completely unmodified —
page 1 already contains full written-out labels and overlaying values
produces orphaned floaters. All step-0 values appear in the sidebar table only.

Positioning rules (generic, no per-schema hardcoding):

For rotation=0 (horizontal labels):
  rawCx is the LEFT edge of the Lx string; text extends rightward.
  vx = rawCx + textWidth*zoom + GAP (5 canvas px after right end)

For rotation≠0 (typically 90° CCW):
  PDF baseline advances in +y_pdf (upward in PDF space).
  After Y-flip, text extends UPWARD in screen space from rawCy.
  rawCy IS the bottom edge of the Lx string — no labelWidthPx offset needed.
  vx = rawCx, vy = rawCy + GAP (5 canvas px below bottom edge)

- textWidth (PDF pts from pdfjs item.width) stored in PointCoord and
  threaded through LabelCoord → overlay props; only used for rotation=0
- Fallback 16 canvas px if textWidth absent (old DB entries pre-redetect)
- Clamped so value never renders outside the canvas bounds

Style:
- Font: bold 11px Inter, color #4A5568
- Background: rgba(230,235,240,0.88) tight behind value text only (3px pad)
- Collision detection: if two value boxes overlap, the later one is skipped

Y-coordinate correction still required:
  correctedY = stored_y + (actual_page_height - 842)
where actual_page_height comes from pdfjs-dist viewport at scale=1,
because detection uses DETECT_PAGE_H=842 as fallback.

## 8. Multi-page execution description PDFs — entry concatenation bug
Root cause (confirmed via debug logging): when a page break falls in the
middle of a record, pdf-parse fuses the end of one entry directly onto
the start of the next with NO separator:

  "DE - L15 - 12DE - ANO_CODE - Z01 - 0"

split(" - ") then yields rawValue = "0" (the last element from the
fused ANO_CODE record), which the `rawValue === "0"` guard discards →
L15 silently dropped.

The old normalization regex only handled [ \t]+ before a section prefix.
It did not catch direct fusion like "12DE".

Fix (permanent — do not remove):
Step 1 — normalize all line terminators before the regex runs:
  cleanText = pdfText.replace(/\r\n/g, "\n").replace(/[\r\x0c]/g, "\n")

Step 2 — insert \n before any section prefix that is NOT already at
the start of a line, using a lookbehind:
  cleanText.replace(/(?<=[^\n])(IM|AM|LM|U_QUE|BO\d*|SE\d*|KS\d*|DE\d*)(?= - )/g, "\n$1")

This is generic — catches both whitespace-separated and zero-separator
concatenation, across any number of pages.
The lookahead (?= - ) prevents false positives inside schema names.

## 9. Viewer crop scaling — "fit to page" (all steps)
Scale = min(containerWidth / cropW, containerHeight / cropH).
This fills the available area in both dimensions without overflow,
handling both landscape (BO/SE/DE) and portrait (KS) crops correctly.

Measured by ResizeObserver on pdfAreaRef in viewer.tsx.
Tracked in two state vars: containerWidth and containerHeight (both updated together in the same observer callback).
Fallback: if crop is null or either dimension < 50px → scale = 1.5.

Centering: PdfViewer outer container uses flex items-center justify-center
(both axes). At base fit-scale the canvas is ≤ container, so centering
works cleanly. At user-zoomed scale, pan gesture handles navigation via
transform: translate(pan.x, pan.y) — CSS centering breakdown at high
zoom is not a problem.

## 10. Print feature — "Drucken" button (BO/SE/KS/DE, 4 pages)
Approach: React portal (createPortal → document.body), NOT a new window/tab.

Screen hiding: `@media print { #root { visibility: hidden; } }`.
Portal `#heer-print-portal` is a direct child of body (sibling to #root).
Portal itself: `visibility: visible` → overrides body inheritance for the portal subtree.

Portal positioned off-screen on screen (`position: fixed; top: -9999px; left: -9999px`)
so canvas buffers ARE rendered (canvases in display:none containers never paint).

Each of 4 print pages is a `.heer-print-page` div (flex column) containing:
  - `.heer-print-page-title` (section label)
  - `.heer-print-pdf-area` (flex:1, centers the PdfViewer canvas)
  - PdfViewer with `interactive={false}` and `onRendered` callback

Scale per section: Math.min(PRINT_W=1060 / cropW, PRINT_H=700 / cropH)
→ guarantees canvas fits in A4 landscape usable area without CSS canvas scaling.
→ overlay canvas alignment is preserved (no CSS rescaling of canvas element).

`@page { size: A4 landscape; margin: 8mm; }` MUST be at TOP LEVEL of <style>,
NOT nested inside @media print — browsers reject nested @page rules.

Timing: onRendered prop added to PdfViewer, called after setLoading(false) in
success path. useEffect waits for printRenderedCount >= 4, then
requestAnimationFrame(() => window.print()); afterprint event unmounts portal.

## 6. WORKING STATE CONFIRMED (do not break this!)
- Auto-detection of L1-L20 positions on page 2 works
  correctly for PLK_W-BO_G-MV_AL
- Execution description parsing correctly extracts
  all BO/SE/KS/DE/global dimensions
- Schema matching by filename substring works
- Dimension table in right sidebar shows correct
  values per section
- Any future change must not break this flow.
  Before changing detectLabels.ts, parseExecution.ts,
  or the matching logic, re-test with
  PLK_W-BO_G-MV_AL execution description and confirm
  the dimension table still shows correct values.

## 7. CONFIRMED APPROACH: Values placed next to Lx labels
The dimension overlay places each value TEXT next to (not replacing)
its Lx anchor point. Original Lx labels remain visible on the PDF.
Values appear to the right (horizontal labels) or below (rotated labels).
Any future change to pdf-viewer.tsx overlay rendering or coordinate
storage MUST be re-tested against PLK_W-BO_G-MV_AL before being
considered complete.
