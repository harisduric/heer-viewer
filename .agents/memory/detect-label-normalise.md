---
name: Detection label key normalisation
description: Why detected label text must be normalised to L{parseInt} before being stored as a DB key
---

## Rule
In `detectLabels.ts`, the DB key for a detected label must always be:
```typescript
const normalizedLabel = `L${parseInt(item.str.slice(1), 10)}`;
```
Never store `item.str` (raw PDF text) directly as a key.

**Why:** Some schema PDFs contain label text like "L09" (with leading zero). The execution PDF parser (`parsePdf.ts`) normalises all codes via `L${parseInt(...)}`, so "L09" → "L9" on the execution side. If detection stores "L09" raw, the viewer lookup `sAllCoords["L9"]` finds nothing, the overlay is silently skipped. PLK_W-BO_LBB_IL had a stray "L09" key alongside "L9" (BO:27), causing the matching L9 overlay to be dropped for that schema. After normalisation fix, BO:26 with a clean "L9" ✓.

**How to apply:** After changing the normalisation, run `pnpm --filter @workspace/scripts run redetect-all` to flush stale raw-key data.
