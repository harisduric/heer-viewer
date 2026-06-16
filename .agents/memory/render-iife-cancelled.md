---
name: Render IIFE cancelled checks
description: canvas.width resets the canvas; check cancelled before it or a stale async IIFE overwrites a correct render
---

In `useEffect` with an async IIFE, the cleanup sets `cancelled = true`. But if the IIFE never checks `cancelled` before mutating the canvas, a stale IIFE (started by an old effect run) can overwrite a fresh correct render.

**The specific hazard — `canvas.width = vp.width`:** Assigning `canvas.width` (even to the same value) **clears the entire canvas**. If a stale IIFE reaches this line after a newer IIFE has already painted the correct page, the canvas is wiped and the stale page is rendered on top.

**Rule:** Check `cancelled` immediately before every side-effecting operation after each `await`:

```js
(async () => {
  const pdf  = await pdfjsLib.getDocument({ data: pdfData.slice() }).promise;
  const page = await pdf.getPage(1);
  const vpNat = page.getViewport({ scale: 1.0 });
  if (cancelled) return;                       // ← after first awaits
  setPdfDims({ w: vpNat.width, h: vpNat.height });
  ...
  if (cancelled) return;                       // ← before canvas reset
  canvas.width  = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
})();
return () => { cancelled = true; };
```

**Why:** Multiple render effects can fire in rapid succession when `containerWidth` (ResizeObserver), `pdfDims`, or `renderScale` changes trigger re-renders. Without the guard, whichever IIFE finishes *last* wins — which may be the stale one.
