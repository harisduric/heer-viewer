---
name: Overlay rendering approach
description: How dimension values are drawn over the schema PDF in pdf-viewer.tsx
---

## Rule
Draw the dimension value TEXT NEXT TO the Lx anchor point — do not cover or replace the original Lx glyph.
Overlays are drawn ONLY for steps 1–4 (BO/SE/KS/DE). Step 0 (Übersicht) renders the PDF unmodified.

## Coordinate system for rotated labels (CRITICAL — easy to get wrong)
For rotation=90° CCW (`atan2(t[1], t[0]) = 90°`, i.e. t[1] > 0):
- PDF baseline advances in +y_pdf direction = UPWARD in PDF space
- After Y-flip (y_screen = pageH - y_pdf): text advances UPWARD in screen space
- Therefore `rawCy` is the **BOTTOM** edge of the Lx string; text extends above it
- Value goes just below: `vy = rawCy + GAP + HALF_H`  ← NO labelWidthPx here

For rotation=0 (horizontal):
- rawCx is the LEFT edge; text extends rightward
- Value goes after the right end: `vx = rawCx + labelWidthPx + GAP`  ← labelWidthPx IS needed

## Why this is asymmetric
Horizontal: rawCx = start of string, need labelWidthPx to reach the end.
Rotated 90° CCW: rawCy = bottom (= start in downward-reading), string goes UP, so rawCy is already the "end" in the downward direction. No extra offset needed.

## Style
- Font: bold 11px Inter, color #4A5568
- Background: `rgba(230,235,240,0.88)`, 3px pad, sized to value text only
- GAP = 5 canvas px (fixed, zoom-independent)
- Collision detection: skip value if its box overlaps an already-drawn box
- Fallback 16px assumed label width when textWidth absent (old DB entries)

## textWidth data flow
`detectLabels.ts` captures `item.width` from pdfjs `getTextContent()` items.
Stored as `PointCoord.textWidth` (PDF pts, rounded to 2dp).
Threaded through `LabelCoord` in `viewer.tsx` → overlay prop in `pdf-viewer.tsx`.
Only used for rotation=0 offset. After any detectLabels.ts change, run `/api/schema/<slug>/redetect`.

**Why not cover rects:** Cover attempts caused bleed onto neighbouring red dimension lines. Placing values next to labels is robust at any zoom.
