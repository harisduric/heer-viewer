---
name: pdfjs-dist v5 render API
description: page.render() in pdfjs-dist v5+ requires an explicit canvas property
---

In pdfjs-dist v5+, `RenderParameters.canvas` is a **required** field even though the docs describe it as having a default.

**Rule:** Always include `canvas: canvasElement` alongside `canvasContext` in every `page.render()` call.

```ts
await page.render({
  canvasContext: ctx,
  canvas: canvasElement,   // required in v5+
  viewport: vp,
}).promise;
```

**Why:** The TypeScript types enforce `canvas` as required (not optional). pdfjs-dist@5.x changed the API; older examples without `canvas` fail the typecheck.

**How to apply:** Any time you write or review a `page.render(...)` call, ensure `canvas` is present.
