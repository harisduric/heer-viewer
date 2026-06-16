---
name: PdfViewer render loop via unstable overlays prop
description: PdfViewer lists overlays in its render-effect deps; a new [] reference every render causes infinite setLoading(true) restarts and stuck spinners.
---

## Rule
`overlays` and `crop` passed to `PdfViewer` must be **stable references** across renders. A new array/object on every render triggers the render effect (which has both in its deps) → `setLoading(true)` → render cancelled → repeat = stuck spinner.

## How to apply
- In `pdf-viewer.tsx`: declare `const EMPTY_OVERLAYS = []` at **module level** and use as the default param. Function-parameter defaults (`overlays = []`) re-create the array on every call.
- In `viewer.tsx`: wrap both `overlays` and `crop` computations in `useMemo` with their true inputs as deps. Without this, every parent re-render (ResizeObserver, state changes) produces a new array reference.
- In the Hebegurt scroll view, each PdfViewer wrapper must have an explicit pixel `width` and `height`. `h-full` on PdfViewer inside an auto-height parent collapses to 0 px, making the canvas invisible.

## Why
pdfjs rendering is async. Each effect restart cancels the previous task (`active = false`) and starts a new fetch + render. If the component re-renders faster than pdfjs can complete (which happens in a loop), `setLoading(false)` never fires → spinner stuck forever. The render loop was driven by:
1. `overlays = []` (new ref each render) → effect re-runs
2. Effect calls `setLoading(true)` → PdfViewer re-renders → parent re-renders (ResizeObserver)
3. Parent passes new props → PdfViewer re-renders → new `overlays = []` → repeat

## Also
- pdfjs throws `RenderingCancelledException` (object with `type` field, NOT an Error subclass) when a render task is cancelled. Suppress it in the catch block with a type-guard; log real errors only.
- Store the render task in `renderTaskRef` and call `.cancel()` in the effect cleanup so pdfjs stops writing to the stale canvas immediately.
