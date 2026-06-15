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

Positioning rules (generic, no per-schema hardcoding):
- rotation=0 or undefined → value drawn to the RIGHT of the label END
  vx = rawCx + textWidth*zoom + GAP (5 canvas px)
- rotation≠0 (typically 90°) → value drawn BELOW the label END
  vy = rawCy + textWidth*zoom + GAP (5 canvas px)
  (for a 90° CCW label the advance direction is screen-downward,
   so textWidth*zoom gives the screen-downward extent of the Lx glyph)
- textWidth (PDF pts from pdfjs item.width) stored in PointCoord and
  threaded through LabelCoord → overlay props for zoom-correct scaling
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
