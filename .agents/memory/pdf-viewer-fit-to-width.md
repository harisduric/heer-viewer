---
name: PdfViewer fitToWidth pattern
description: How to render schema PDFs at an exact pixel width regardless of native page dimensions
---

## Rule
Use the `fitToWidth` prop on PdfViewer whenever you need a page to fill a known pixel width. Never compute scale by dividing by 595 (A4 assumption) — schema PDFs can be A4, landscape, A3, or custom widths.

## How it works
- `fitToWidth` is passed as a number (px).
- PdfViewer derives `renderZoom = fitToWidth / viewport1.width` using the page's actual native width in points.
- `onDimensions` callback fires after render with `{ widthPx, heightPx }` so the caller can size a wrapper div to the exact canvas height.
- The wrapper should default to `Math.round(fitToWidth * 842 / 595)` (A4 portrait aspect ratio) until `onDimensions` fires with the real height.

**Why:** LAV_W-BO_G-MV_AL schema pages are wider than 595pt. Using scale=1.8 * 595 overflowed the 1071px wrapper; `items-center` then clipped both edges symmetrically — visually looked like a clipping bug but was actually an overflow bug.

## Reserve px for scrollbar
When the scroll container will overflow vertically (e.g. 4 tall Hebegurt pages), a vertical scrollbar appears on Windows/Linux (~17px) consuming horizontal space. Reserve 56px total: 32 (p-4 padding) + 24 (scrollbar gutter). Compute: `Math.max(100, containerWidth - 56)`.
