# PERMANENT TECHNICAL DECISIONS

All decisions below are CONFIRMED WORKING against PLK_W-BO_G-MV_AL.
Do not change any of these without re-testing the full viewer flow.

---

## CONFIRMED BASELINE — ready for production pilot test

Features confirmed working as of this checkpoint:

1. **Below-label value positioning with collision fallback** (§5)
   - Values placed below their Lx label by default (centered horizontally)
   - 4-candidate fallback waterfall: below → right → above → left
   - Each candidate clamped to canvas bounds before collision check
   - If all 4 candidates collide, candidate 1 is drawn anyway — a value
     is NEVER silently omitted
   - Adaptive font: FONT_LARGE=18px / FONT_SMALL=13px based on cluster
     proximity (CLUSTER_RADIUS=60 PDF pts)

2. **5-page print output** (§8)
   - Page 1: Übersicht — full drawing, no overlays, no legend table
   - Pages 2–5: BO / SE / KS / DE — drawing + compact Label/Maß legend
     table (110pt right-side column, 7.5pt font)
   - Legend data sourced from parsedExecution.sections[sKey]
   - Works generically for any schema (not hardcoded for PLK_W-BO_G-MV_AL)

3. **Multi-page execution description parsing** (§6)
   - Handles fused page-break records in pdf-parse output
   - Normalises line terminators + inserts \n before section prefixes

---

## 1. PDF Canvas Scaling (Koordinaten Editor)
ALWAYS use ResizeObserver on the container div ref.
Scale = containerDiv.clientWidth / pageWidthInPoints
Never use window.innerWidth.
Re-render on resize.

---

## 2. PDF Cache Busting
ALWAYS append ?t=Date.now() to all PDF fetch URLs.
Reload PDF when schema selection changes.

---

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

---

## 4. Koordinaten Editor — Page Model
The editor has two dropdown tabs:
- Seite 1 — Übersicht (global dimensions, label positions on page 1)
- BO/SE/KS/DE — Crop-Editor (crop rectangles + per-section page numbers)

Each section (BO/SE/KS/DE) has its own PDF page number stored as
`page2_crops[section].page` (integer, 1-indexed, default 2).
Schemas without this field fall back to page 2 (backward compat).

The old "Seite 3 — KS/SE/DE" dropdown entries are REMOVED.
They were a dead legacy concept replaced by the Hebegurt multi-page approach.

detectLabels.ts scans whichever pages are configured in the cropMap
(via cropMap[sec].page) and restricts label assignment to sections
configured on the same page as each text item.

---

## 5. Detection Page Height — ALWAYS USE DETECT_PAGE_H=842

**Never use `vp.height` from pdf-parse inside `detectLabels.ts`.**

In the `pagerender` hook, always set `const ph = DETECT_PAGE_H` (842), even when `vp.height` is defined and finite.

**Why:** The crop-containment test in `assignSection` shifts crop boundaries by
`yOffset = DETECT_PAGE_H − actualPageH` so that both coordinate systems match.
If detection uses `vp.height` (e.g. 595 for A4 landscape) instead of 842, every
stored y value shifts by ~247 pts relative to what the containment test expects.
Labels near the top of the page then fall outside all crop rectangles and are
assigned by Voronoi to the wrong section, producing values at random positions.

The viewer's `yAdjust = naturalPageH − 842` correction already compensates for
the real page height at render time — this only works when detection stored
coordinates using `ph = 842`.

**Fix committed:** `void page.getViewport(…)` is kept (pdfjs layout cache), then
`const ph = DETECT_PAGE_H;` — no conditional on `vp.height`.

After changing this line, ALL schema PDFs must be re-detected via
`POST /api/schema/:name/redetect` (or the redetect-all script in `scripts/src/`).

---

## 6. Overlay Rendering — CONFIRMED WORKING

**Final approach: value placed NEXT TO its Lx anchor. Do not cover or replace the Lx label.**

The original Lx text in the PDF is left completely untouched.
Overlays are ONLY drawn for steps 1–4 (BO/SE/KS/DE).
Step 0 (Übersicht) renders the PDF unmodified — page 1 already contains
full written-out labels; all step-0 values appear in the sidebar table only.

### Positioning rules

**rotation=0 (horizontal labels):**
- rawCx = left edge of the Lx glyph (canvas px)
- vx = rawCx + textWidth*zoom + GAP (5 canvas px after right end of Lx)
- vy = rawCy (same baseline)

**rotation≠0 (typically 90° CCW):**
- PDF baseline advances in +y_pdf (upward); after Y-flip rawCy IS the
  BOTTOM edge of the Lx glyph in screen space
- vx = rawCx, vy = rawCy + GAP + HALF_H (just below the bottom edge)
- No labelWidthPx offset needed

**Y-coordinate correction (always required):**
  correctedY = stored_y + (actual_page_height − 842)
Detection uses DETECT_PAGE_H=842; pdfjs-dist returns the real height.

### textWidth
`textWidth` (PDF pts from pdfjs item.width) is stored in PointCoord and
threaded through LabelCoord → overlay props.
- rotation=0: used directly (multiply by zoom for canvas px)
- rotation≠0: not used for positioning
- Fallback: 16 canvas px when textWidth is absent (old DB entries)

### Style
- Font: bold, Inter, color #4A5568
  - FONT_LARGE = 18px for non-clustered labels
  - FONT_SMALL = 13px for labels with any neighbour within CLUSTER_RADIUS=60 PDF pts
    (catches tight groups such as L2/L3/L4 in BO/SE, L7/L9 in KS, L11/L12/L13)
  - Cluster check in PDF-point space (zoom-independent); FONT and HALF_H computed
    per-item inside the draw loop before measureText
- Background: rgba(230,235,240,0.88), 3px pad, tight behind value text only
- Clamped so value never renders outside canvas bounds

### Fallback positioning — values must NEVER be invisible
Four candidate positions tried in order; each is clamped to canvas bounds first:
  1. Below (preferred) — centered horizontally under the label
  2. Right — after the right/bottom end of the label
  3. Above — centered horizontally above the label
  4. Left — to the left of the label
First collision-free candidate is used. If ALL four collide (dense cluster),
candidate 1 is drawn anyway. A value must always appear; never silently omitted.
DO NOT add `continue` / skip logic that can make a value invisible.

### DO NOT use these abandoned approaches
- ~~Cover box~~ (white rect over Lx then re-draw) — hides original label, poor UX
- ~~Rotation cover~~ (rotated white rect) — same problem, complex math
- ~~textWidth cover~~ (pre-computed glyph width for cover) — same

---

## 6. Multi-page Execution Description Parsing — CONFIRMED WORKING

### Root cause
When a page break falls mid-record, pdf-parse fuses entries directly:
  `"DE - L15 - 12DE - ANO_CODE - Z01 - 0"`
split(" - ") yields rawValue="0" → discarded → L15 silently dropped.

### Fix (do not remove)
Step 1 — normalize line terminators:
```
cleanText = pdfText.replace(/\r\n/g, "\n").replace(/[\r\x0c]/g, "\n")
```
Step 2 — insert \n before any section prefix **immediately preceded by a digit**:
```
cleanText.replace(
  /(?<=\d)(IM|AM|LM|U_QUE|BO\d*|SE\d*|KS\d*|DE\d*)(?= - )/g,
  "\n$1"
)
```
**IMPORTANT — do NOT change `(?<=\d)` back to `(?<=[^\n])`.**
The `[^\n]` variant matched "DE" inside "ANO_CODE" (the "O" before "DE" is
not a newline), which silently destroyed every ANO_CODE entry and broke
the Hebegurt step. The `\d` lookbehind restricts insertion to genuinely
fused records (value digit immediately followed by section prefix) while
leaving tokens like "ANO_CODE" untouched.

The lookahead `(?= - )` prevents false positives inside schema names.
Generic — catches zero-separator concatenation across any number of pages.

---

## 7. Fit-to-page Viewer Scaling — CONFIRMED WORKING

Scale = min(containerWidth / cropW, containerHeight / cropH)

Fills available area in both dimensions without overflow, handling both
landscape (BO/SE/DE) and portrait (KS) crops correctly.

Measured by ResizeObserver on pdfAreaRef in viewer.tsx.
Both containerWidth and containerHeight updated together in the same observer callback.
Fallback: scale = 1.5 when crop is null or either dimension < 50px.

Centering: PdfViewer outer container uses `flex items-center justify-center`
(both axes). At base fit-scale the canvas is ≤ container so centering works.
At user-zoomed scale, pan gesture via `transform: translate(pan.x, pan.y)`
handles navigation — CSS centering breakdown at high zoom is not a problem.

---

## 8. Print Feature ("Drucken") — CONFIRMED WORKING

Prints 5 pages: Übersicht → BO → SE → KS → DE, A4 landscape.
BO/SE/KS/DE pages include a compact Label/Maß legend table on the right side.
Übersicht page has no legend (global dims not tied to Lx labels on the drawing).

### DO NOT use these abandoned approaches
- ~~Off-screen PdfViewer portal (position:fixed; top:-9999px)~~: browsers
  do not reliably paint canvas buffers that are far off-screen → blank pages.
- ~~visibility:hidden on #root~~: still occupies layout space → phantom blank
  pages appear alongside real ones in the print preview.

### Correct approach: capture on-screen canvases, print as \<img\> tags

**Capture phase:**
1. Click "Drucken" → captureQueueRef = { step:0, images:[], originalStep:N }
2. isCapturing=true, step forced to 0 (Übersicht); navigation buttons disabled
3. Main on-screen PdfViewer receives `onRendered={handlePrintRendered}`
   - `onRendered` is now in the PdfViewer dep array so the effect re-fires when
     it changes from undefined → function (needed if user was already on step 0)
   - `handlePrintRendered` is wrapped in useCallback (empty deps) so its
     reference is stable and won't re-trigger the effect spuriously
4. After each render: PdfViewer composites pdfCanvas + overlayCanvas into a
   temp canvas, calls `onRendered(composite.toDataURL('image/png'))`
5. handlePrintRendered pushes dataUrl, advances step 0→1→2→3→4;
   after step 4 restores originalStep, sets printImages (5 items)

**Print phase:**
6. useEffect on printImages (length ≥ 5) calls `window.print()` after React
   commits the portal (effects always fire after DOM commit)
7. Portal at document.body:
   - Page 0 (Übersicht): full-width drawing image, no legend
   - Pages 1–4 (BO/SE/KS/DE): drawing image + `.heer-pv-legend` sidebar table
     (110pt wide, 7.5pt font, Label/Maß from parsedExecution.sections[sKey])
8. `afterprint` event → setPrintImages(null) → portal unmounts

**CSS:**
```css
@page { size: A4 landscape; margin: 8mm; }           /* TOP LEVEL — not inside @media print */
@media screen { #heer-print-view { display: none !important; } }
@media print {
  #root { display: none !important; }                /* display:none → zero layout space */
  #heer-print-view { display: block; }
}
```
`@page` MUST be at top level of the `<style>` block — browsers ignore it when
nested inside `@media print`.

**Why captureQueueRef instead of state:**
State updates are batched; reading captureStep from a useCallback closure risks
stale values across 5 sequential renders. Mutating captureQueueRef.current
directly is always fresh.

---

## KNOWN OPEN ISSUES

### Per-section page model — tested same-page only
The per-section page model (§4) is implemented and working. Each BO/SE/KS/DE
section can be configured with its own PDF page number via the Koordinaten editor
(page2_crops[section].page, default 2).

**Testing status:**
- Confirmed working with all four sections on the SAME page (page 2) for both
  PLK_W-BO_G-MV_AL and LAV_W-BO_G-MV_AL.
- NOT yet tested with sections actually split across different pages (e.g. BO on
  page 2, SE/KS/DE on page 3), as would be required for PLK_W-BO_G-MV_IL
  per the original project notes.

This cross-page split case remains to be verified end-to-end: configure a section
on a different page in the Koordinaten editor, upload/re-detect labels, confirm the
viewer fetches the correct page and overlays land in the right position.
