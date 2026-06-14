---
name: Label detection coordinate system
description: Two separate Y coordinate spaces used in label detection; must convert crop regions before comparing with detected label positions.
---

## The two spaces

| Space | Used by | Y origin | Formula |
|-------|---------|----------|---------|
| pdfjs-space | koordinaten.tsx crops, client canvas | top (0) | y_screen = pageH_actual − PDF_y |
| detection-space | detectLabels.ts | top (0) | y_stored = 842 − PDF_y |

`pageH_actual` for PLK_W-BO_G-MV_AL is 595 (A4 landscape). pdf-parse's `vp.height` is `undefined` for this PDF, so detection always uses the hardcoded constant 842.

## Conversion formula

To compare a crop region (pdfjs-space) with a detected label (detection-space):

```
yOffset = 842 − (maxCropBottom + 20)
detCropYMin = cropY + yOffset
detCropYMax = cropY + cropH + yOffset
```

Where `maxCropBottom = max(cropY + cropH)` across all four section crops, and `+20` is the A4-landscape whitespace margin below the lowest crop.

For the PLK_W-BO_G-MV_AL schema:
- `maxCropBottom` = 575 (DE crop: cropY=323, cropH=252)
- `actualPageH` = 575 + 20 = 595 ✓
- `yOffset` = 842 − 595 = 247

SE crop pdfjs (y:21–320) → detection-space (y:268–567).

## Why the 50-point margin was wrong

Using `margin=50` → `actualPageH=625` → `yOffset=217` → SE crop detection range y:238–537. Label SE.L12 at y=558 fell outside (558>537) → went to Voronoi → was assigned to DE. Reducing to `margin=20` puts the range at y:268–567, and 558 ∈ [268,567] → correctly assigned to SE.

**Why:** A4 landscape has exactly 20pt of whitespace below the lowest section crop. Using 50pt overestimates the page height, shrinking the converted crop range and losing border labels.

## Viewer correction (separate)

The viewer compensates for the 842-flip when rendering: `correctedY = storedY + (naturalPageH − 842)` where `naturalPageH` comes from pdfjs-dist at runtime (595 for this PDF). This is consistent with detection using 842 as the flip base.
