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
- This runs automatically on every upload
- No manual label positioning needed

## 4. Beschriftungs-Positionen Views
These views (BO/SE/KS/DE Beschriftung) are REMOVED
from the Koordinaten editor. They are not needed.
The Koordinaten editor only has:
- Seite 1 — Übersicht (global dimensions)
- Seite 2 — Crop-Editor (BO/SE/KS/DE regions)
- Seite 3 — KS/SE/DE (ANO_CODE crops)

## 5. Overlay Rendering in Viewer
Dimension values are overlaid on the PDF canvas
at the auto-detected L1/L2 coordinates.
Color: #4A5568, font: bold 11px Inter.
White background rectangle behind each value.
Coordinates are scaled by current render scale.
