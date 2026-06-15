---
name: Overlay rendering approach
description: How dimension values are drawn over the schema PDF in pdf-viewer.tsx
---

## Rule
Draw the dimension value TEXT NEXT TO the Lx anchor point — do not cover or replace the original Lx glyph.

- rotation=0 (horizontal label): value goes to the RIGHT of the label END
  `vx = rawCx + textWidth*zoom + GAP_PX`
- rotation≠0 (rotated label, typically 90° CCW): value goes BELOW the label END
  `vy = rawCy + textWidth*zoom + GAP_PX`
  (for 90° CCW labels, advance direction is screen-downward, so textWidth*zoom = screen-vertical extent)
- GAP_PX = 5 canvas pixels (fixed, zoom-independent)
- Font: bold 11px Inter, color #4A5568
- Background: `rgba(230,235,240,0.88)`, 3px pad, sized to value text only
- Collision detection: skip value if its box overlaps an already-drawn box
- Fallback: 16px assumed label width when textWidth absent (old DB entries)

## textWidth data flow
`detectLabels.ts` captures `item.width` from pdfjs `getTextContent()` items.
Stored as `PointCoord.textWidth` (PDF pts, rounded to 2dp).
Threaded through `LabelCoord` in `viewer.tsx` → overlay prop in `pdf-viewer.tsx`.
After any detectLabels.ts change, run `/api/schema/<slug>/redetect` to refresh DB.

**Why:** A gap measured from the anchor START (baseline-left) places value text inside the Lx glyph, causing visual merging. Using textWidth*zoom to find the label END, then adding a small fixed gap, correctly separates label and value at any zoom.

**Why not cover rects:** Multiple cover-rect attempts all caused bleed onto neighbouring red dimension lines at various zoom levels. Covering is fragile because required cover size varies with PDF fonts and zoom. Placing values next to labels is robust at any zoom and leaves the original drawing fully intact.
