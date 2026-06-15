---
name: Overlay rendering approach
description: How dimension values are drawn over the schema PDF in pdf-viewer.tsx
---

## Rule
Draw the dimension value TEXT NEXT TO the Lx anchor point — do not cover or replace the original Lx glyph.

- rotation=0 (horizontal label): value goes to the RIGHT, `vx = rawCx + 8px gap`
- rotation≠0 (rotated label, typically 90°): value goes BELOW, `vy = rawCy + 8px gap + halfH`
- Font: bold 11px Inter, color #4A5568
- Background: `rgba(230,235,240,0.88)`, 3px pad, sized to value text only
- Collision detection: skip value if its box overlaps an already-drawn box (handles tight clusters)

**Why:** Multiple cover-rect attempts (axis-aligned, rotated, exact-glyph-size) all caused visible bleed onto neighbouring red dimension lines at various zoom levels. White covers are fundamentally fragile because the cover size depends on render-time glyph metrics that vary with PDF fonts and zoom. Placing values next to labels is robust at any zoom and leaves the original drawing fully intact.

**How to apply:** The `rotation` field from `PointCoord` is still stored in detection and threaded through to overlay props — it drives the "right vs below" positioning decision. `textWidth`/`textHeight` are not needed and must not be re-added.
