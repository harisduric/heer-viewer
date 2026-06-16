---
name: pdfjs buffer transfer
description: pdfjs.getDocument({data: Uint8Array}) transfers the ArrayBuffer to the worker, neutering React state; fix with .slice()
---

When you call `pdfjsLib.getDocument({ data: uint8Array })` in a Web Worker environment (pdfjs-dist v5+), pdfjs uses `postMessage` with Transferable semantics internally. This **transfers** the `uint8Array.buffer` to the worker thread, which **detaches / neuters** the original `ArrayBuffer`. The Uint8Array object still exists in JS, but its `byteLength` becomes `0` and any attempt to read data from it fails.

**Why this matters in React:** if you store the Uint8Array in React state (`setPdfData(arr)`) and then pass that same state reference to `getDocument`, after the first render the state variable is neutered. Every subsequent `useEffect` run that re-uses the same `pdfData` reference (e.g., triggered by `containerWidth` or `pdfDims` changing) finds `byteLength === 0` and pdfjs throws an empty `{}` error. The canvas is never updated with the correct new page, appearing visually "stuck".

**How to apply:** Always pass an independent copy to `getDocument`:
```js
pdfjsLib.getDocument({ data: pdfData.slice() })
```
`slice()` creates a new Uint8Array with its own `ArrayBuffer`. pdfjs transfers the slice's buffer; the original `pdfData` in React state is never touched and stays intact for future renders.

Add a byteLength guard as a safety net:
```js
if (pdfData.byteLength === 0) return; // detached — skip
```
