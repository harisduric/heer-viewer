---
name: detectLabels pageH bug
description: vp.height is undefined in pdf-parse pdfjs; causes all Y coords to be NaN (→ null in DB)
---

## The rule
Always guard `vp.height` with `Number.isFinite` before assigning to `pageH`.

```typescript
const vp = page.getViewport({ scale: 1.0 });
if (Number.isFinite(vp.height)) pageH = vp.height;
```

**Why:** pdf-parse v1.1.1 uses its own bundled pdfjs-dist (v2.x). `getViewport()` returns an object but `height` is `undefined` at runtime (the TypeScript interface says `number` but the actual value differs). Without the guard, `pageH = undefined`, making `pageH - t[5] = NaN`, which JSON.stringify encodes as `null`.

**How to apply:** Any time `getViewport()` is used inside a `pdf-parse` pagerender hook, guard the height assignment. Also guard `t[5]` with `Number.isFinite(t[5])` since `typeof NaN === "number"` is true in JS.

**Additional symptom:** When pageH is undefined, all label section assignments default to "SE" because `NaN < Infinity === false` means the `nearest` variable is never updated past its initial value.

**Confirmed fix:** After the fix, PLK_W-BO_G-MV_AL detected 43 labels correctly spread across BO/SE/KS/DE with valid (x,y) coordinates.
