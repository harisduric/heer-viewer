---
name: Rotated label cover sizing
description: How to size the white cover rect that hides original L-label glyphs in pdf-viewer.tsx
---

## Rule
Use exact glyph metrics from pdfjs detection — NOT guessed fixed sizes.

- `textWidth` = `item.width` (pdfjs TextItem advance width, in PDF user-space units / points)
- `textHeight` = `Math.hypot(t[0], t[1])` (font em-square height, same units)
- Stored in `PointCoord` during detection, threaded through `LabelCoord` → overlay props
- In canvas: `twPx = overlay.textWidth * zoom`, `thPx = overlay.textHeight * zoom`
- `COVER_PAD = 2` (px) — only to hide anti-aliased edge pixels
- `fillRect(-2, -(thPx + 2), twPx + 4, thPx + 4)` — anchored at baseline-left (rawCx, rawCy)

**Why:** A fixed cover size (e.g. `max(12, 8*zoom)`) grows with zoom faster than actual glyph size, bleeding into neighbouring red dimension lines at typical tablet zoom levels. Exact dimensions from the PDF itself scale correctly at any zoom.

**How to apply:** If cover-rect logic in pdf-viewer.tsx is ever touched, keep COVER_PAD ≤ 3px. Any larger and covers start clipping adjacent dimension numbers at dense label regions (BO/SE/KS/DE step views).
