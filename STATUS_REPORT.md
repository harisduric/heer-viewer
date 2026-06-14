# STATUS REPORT — Heer Viewer
**Generated:** 2026-06-14  
**Project:** B. Heer AG Verpackungen — Production-floor schema viewer

---

## 1. PROJECT STRUCTURE

### 1.1 Frontend — `artifacts/heer-viewer/src/`

```
artifacts/heer-viewer/src/
├── App.tsx
├── main.tsx
├── index.css
├── store.ts                          # Zustand store: parsedExecution state
├── components/
│   ├── icons.tsx
│   ├── layout.tsx                    # Header, sidebar, bottom bar
│   ├── pdf-viewer.tsx                # PDF.js canvas + overlay rendering, collision dedup, cluster font
│   └── ui/                           # shadcn/ui components (accordion, button, card, dialog, …)
├── hooks/
│   ├── use-mobile.tsx
│   └── use-toast.ts
├── lib/
│   └── utils.ts
└── pages/
    ├── import.tsx                    # Drag-and-drop execution PDF upload
    ├── viewer.tsx                    # 5-step workflow viewer with ResizeObserver scaling
    ├── bibliothek.tsx                # 17-slot schema library management
    ├── koordinaten.tsx               # Admin crop + coordinate editor
    └── not-found.tsx
```

### 1.2 Backend — `artifacts/api-server/src/`

```
artifacts/api-server/src/
├── app.ts                            # Express app setup
├── index.ts                          # Server entry point
├── lib/
│   ├── detectLabels.ts               # Auto-detection of L1–L20 positions on PDF page 2
│   ├── gcsStorage.ts                 # Replit Object Storage upload/stream/delete
│   ├── logger.ts                     # Pino logger
│   ├── objectAcl.ts
│   ├── objectStorage.ts
│   ├── parsePdf.ts                   # Execution description parsing + schema matching
│   └── seed.ts                       # 17 canonical slot names + DB seeding
└── routes/
    ├── index.ts                      # Router aggregator
    ├── health.ts                     # GET /healthz
    ├── execution.ts                  # POST /upload-execution
    ├── schemas.ts                    # Schema library CRUD + redetect
    └── coordinates.ts                # Coordinate CRUD
```

### 1.3 Shared Libraries — `lib/`

```
lib/
├── api-spec/
│   ├── openapi.yaml                  # API contract (source of truth)
│   └── orval.config.ts               # Codegen config
├── api-client-react/
│   └── src/
│       ├── generated/api.ts          # TanStack Query hooks (generated)
│       ├── generated/api.schemas.ts  # Zod schemas (generated)
│       └── index.ts                  # Barrel export
├── api-zod/
│   └── src/generated/               # Server-side Zod validation types (generated)
└── db/
    ├── drizzle.config.ts
    └── src/
        ├── index.ts
        └── schema/
            └── schemas.ts            # DB schema definition
```

### 1.4 Database Schema — `lib/db/src/schema/schemas.ts`

```typescript
import { pgTable, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const schemasTable = pgTable("schemas", {
  name:        varchar("name", { length: 100 }).primaryKey(),
  object_path: varchar("object_path", { length: 500 }),   // GCS object path for stored PDF
  uploaded_at: timestamp("uploaded_at"),
  coordinates: jsonb("coordinates"),                       // Full coordinate blob (see §9 below)
  status:      varchar("status", { length: 20 }).default("missing"),
});
```

**`coordinates` JSONB structure:**
```json
{
  "page1":       { "IM-LÄNGE": {"x":…,"y":…}, … },
  "page2_crops": { "BO": {"cropX":…,"cropY":…,"cropW":…,"cropH":…}, "SE":{…}, "KS":{…}, "DE":{…} },
  "page2":       { "BO": {"L1":{"x":…,"y":…},…,"L11":{…}}, "SE":{…,"L15":{…}}, "KS":{…,"L9":{…}}, "DE":{…,"L15":{…}} },
  "page2_all":   { "BO": {"L1":[{"x":…,"y":…},…]}, … },   ← multi-position duplicates per label
  "page3":       { "KS": {"11":{cropX,cropY,cropW,cropH}, …}, "SE":{…}, "DE":{…} }
}
```

---

## 2. CURRENT DATABASE STATE

Query run: `SELECT name, status, has_pdf, has_crops, has_page2, has_page2_all, bo_count, se_count, ks_count, de_count FROM schemas ORDER BY name`

| Schema Name | Status | PDF | page2_crops | page2 | page2_all | BO labels | SE labels | KS labels | DE labels |
|---|---|---|---|---|---|---|---|---|---|
| BASIC | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| LAV_W-BO_G-MV_AL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| LAV_W-BO_G-OV_AL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| PLK_PLBO_KUF_IL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| **PLK_W-BO_G-MV_AL** | **loaded** | **✓** | **✓** | **✓** | **✓** | **11** | **15** | **9** | **15** |
| PLK_W-BO_G-MV_IL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| PLK_W-BO_G-OV_AL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| PLK_W-BO_G-OV_IL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| PLK_W-BO_KUF-LB_IL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| PLK_W-BO_LBB_IL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| PLK_W-BO_N_IL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| SPEDI-BOX-FLEX_KUF | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| SPEDI-BOX-FLEX_QBB | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| VHB_PAL_W-BO | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| VHK_VHBO_N_IL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| VHK_W-BO_G-MV_AL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |
| VHK_W-BO_G-OV_AL | missing | ✗ | ✓ | ✓ | ✗ | 11 | 15 | 9 | 15 |

**Notes:**
- All 16 `missing` schemas have `page2_crops` and `page2` seeded from PLK_W-BO_G-MV_AL during an earlier seeding pass. These values are placeholders — correct values require uploading the actual schema PDF and running redetect.
- `page2_all` (multi-occurrence positions per label) is only populated for PLK_W-BO_G-MV_AL (the only schema with an uploaded PDF).

### PLK_W-BO_G-MV_AL — Label counts confirmed

| Section | Labels detected | Expected per spec |
|---|---|---|
| BO | 11 | 11 |
| SE | 15 | 15 |
| KS | 9 | 9 |
| DE | 15 | 15 |

**Total: 50 labels detected. All complete.**

Known `page2_all` duplicates (same label text found at multiple positions on the drawing):
- BO: L2×4, L3×6  
- SE: L2×2, L3×3  
- KS: L2×3, L4×2  
- DE: L4×3, L6×3

---

## 3. FIXES.md AND SPEC.md CONTENT

### 3.1 FIXES.md (current content — `FIXES.md` in project root)

```markdown
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
at the auto-detected L1/L20 coordinates.
Color: #4A5568, font: bold 13px Inter.
White background rectangle behind each value (6px padding).
Padding must be large enough to fully cover the original
L-label text and any adjacent small dimension numbers.
Coordinates are scaled by current render scale.
Y coordinates must be corrected for the pageH detection fallback:
  correctedY = stored_y + (actual_page_height - 842)
where actual_page_height comes from pdfjs-dist viewport at scale=1.

## 6. WORKING STATE CONFIRMED (do not break this!)
- Auto-detection of L1-L20 positions on page 2 works
  correctly for PLK_W-BO_G-MV_AL
- Execution description parsing correctly extracts
  all BO/SE/KS/DE/global dimensions
- Schema matching by filename substring works
- Dimension table in right sidebar shows correct
  values per section
- Any future change must not break this flow.
  Before changing detectLabels.ts, parseExecution.ts,
  or the matching logic, re-test with
  PLK_W-BO_G-MV_AL execution description and confirm
  the dimension table still shows correct values.

## 7. CONFIRMED WORKING: Overlay replaces L-labels
CONFIRMED WORKING: Dimension overlay correctly replaces
L-labels with execution description values for
PLK_W-BO_G-MV_AL across all 5 steps (Übersicht, BO,
SE, KS, DE). Any future change to detectLabels.ts,
pdf-viewer.tsx overlay rendering, or coordinate storage
MUST be re-tested against this schema before being
considered complete.
```

### 3.2 spec.md (source: `attached_assets/spec_1781158549286.md`)

> Full spec is 557 lines. Key sections summarised; full file at `attached_assets/spec_1781158549286.md`.

**Project:** Production-floor tablet/PC web app — eliminates paper schema comparison. User imports execution description PDF; app matches schema, overlays dimensions, guides step-by-step.

**Tech stack (as specced):** React + Tailwind, Node/Express, PostgreSQL/Drizzle, Replit Object Storage, pdf-parse (server), pdfjs-dist (client).  
*(Note: actual implementation uses Vite+Wouter+Zustand+TanStack Query+shadcn/ui — deviations from spec that have been resolved in practice.)*

**17 canonical slot names:**
```
PLK_W-BO_G-MV_AL, PLK_W-BO_G-OV_AL, PLK_W-BO_G-MV_IL, PLK_W-BO_G-OV_IL,
LAV_W-BO_G-MV_AL, LAV_W-BO_G-OV_AL, VHK_W-BO_G-MV_AL, VHK_W-BO_G-OV_AL,
PLK_W-BO_LBB_IL, PLK_W-BO_KUF-LB_IL, PLK_PLBO_KUF_IL, BASIC,
PLK_W-BO_N_IL, VHK_VHBO_N_IL, VHB_PAL_W-BO, SPEDI-BOX-FLEX_QBB, SPEDI-BOX-FLEX_KUF
```

**Viewer steps:**
| Step | Name | Content |
|---|---|---|
| 0 | Übersicht | Page 1 + global dimension overlays |
| 1 | BO (Boden) | Page 2 BO crop + L-value overlays |
| 2 | SE (Seite) | Page 2 SE crop + L-value overlays |
| 3 | KS (Kopfstück) | Page 2 KS crop + L-value overlays |
| 4 | DE (Deckel) | Page 2 DE crop + L-value overlays |
| 5 | Hebegurt | Page 3 ANO_CODE crop(s) — only if any ANO_CODE ≠ 0 |

---

## 4. LAST COMPLETED TASK

### Task: Overlay rendering — 3 fixes

**Status: Implemented, typechecked clean. Needs live browser re-test with PDF loaded.**

Three improvements were applied in the last session:

**FIX 1 — Fill container width with crop (viewer.tsx + pdf-viewer.tsx)**  
- `viewer.tsx`: Added `ResizeObserver` on `pdfAreaRef` div; computes `scale = containerWidth / crop.cropW` (floor 1.5) and re-runs on container resize.  
- `pdf-viewer.tsx`: Added `useEffect(() => setZoom(scale), [scale])` so external scale prop stays synced to internal zoom state.  
- Container changed from `overflow-hidden` to `overflow-auto flex-col items-center` so tall canvases scroll vertically.

**FIX 2 — Collision deduplication (pdf-viewer.tsx)**  
- Pre-computes all overlay canvas positions first.  
- Tracks `drawnBoxes[]`; before drawing each overlay, checks bounding box overlap against all already-drawn boxes; skips if overlap > 30% of the smaller box's area.  
- Prevents the "same value stacked twice" problem caused by `page2_all` duplicate positions.

**FIX 3 — Cluster font sizing (pdf-viewer.tsx)**  
- Counts neighbours within 55px canvas radius for each overlay position.  
- Uses 11px font (instead of 13px) when 2+ neighbours are present.  
- Gives breathing room to tight groups like L2/L3/L4.

**Verification:**  
- `pnpm --filter @workspace/heer-viewer run typecheck` → ✓ clean  
- HMR confirmed live in browser (Vite logs show both `viewer.tsx` and `pdf-viewer.tsx` updated)  
- Visual confirm pending — requires loading PDF in browser (Zustand store is in-memory; the screenshot tool opens a fresh session without loaded PDF)

---

## 5. KNOWN ISSUES / TODO

| # | Area | Issue | Severity |
|---|---|---|---|
| 1 | Overlay visual | FIX 1–3 implemented but not yet confirmed visually with a live PDF in the actual production browser session | Needs test |
| 2 | DB — 16 missing schemas | 16 of 17 schema slots have no uploaded PDF (`status: missing`). Coordinates are seeded from PLK_W-BO_G-MV_AL and are wrong for other schemas. | Awaiting customer PDFs |
| 3 | page2_all — other schemas | `page2_all` is only populated for PLK_W-BO_G-MV_AL. Remaining 16 will need re-detection after PDF upload. | By design; populate on upload |
| 4 | Hebegurt step (Step 5) | Viewer implements the Hebegurt step; page3 ANO_CODE crops are seeded as placeholders. Correct crop positions for page 3 have not been defined per-schema. | Needs admin crop setup |
| 5 | page1 global overlays | Coordinate editor supports page1 placement; visual confirmation of global dimension overlay positions not tested. | Needs test |
| 6 | Spec vs implementation delta | Spec references `concurrently` + ports 3000/3001 (original monolith); actual implementation is a pnpm monorepo with separate artifact workflows on dynamic ports. | Resolved; no action needed |
| 7 | Touch gestures | Spec calls for pinch-zoom + drag-pan in viewer. Current pdf-viewer.tsx implements mouse-wheel zoom and click-drag pan but touch gesture support not confirmed on tablet. | Spec gap |

---

## 6. KEY API ENDPOINTS

All routes are prefixed with `/api` via the shared reverse proxy.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/healthz` | Health check; returns `{ status: "ok" }` |
| `POST` | `/api/upload-execution` | Upload execution description PDF (multipart). Parses text, matches to a schema slot by filename substring, returns `ParsedExecution` JSON with `globalDimensions`, `sections` (BO/SE/KS/DE), `anoCodes`, and `matchedSchema`. |
| `GET` | `/api/schema-library` | Returns all 17 schema slot rows (name, status, object_path, uploaded_at, coordinates). |
| `GET` | `/api/schema/:name/page/:num` | Streams page `num` (1–10) of the stored schema PDF as `application/pdf` array buffer. Extracts the specific page via `pdf-lib` before streaming. |
| `POST` | `/api/schema/:name/upload` | Upload a schema drawing PDF (multipart) into a named slot. Stores in Object Storage, records `object_path` + `uploaded_at`, triggers auto-detection of L-labels on page 2, saves `page2` and `page2_all` to DB, sets `status: loaded`. |
| `POST` | `/api/schema/:name/redetect` | Re-runs label auto-detection on the already-stored PDF for slot `:name`. Updates `page2` and `page2_all` in DB. Returns count of detected labels. |
| `PATCH` | `/api/schema/:name/rename` | Renames a schema slot (updates primary key). Used in admin tooling. |
| `GET` | `/api/coordinates/:name` | Returns the full `coordinates` JSONB blob for a schema slot. |
| `PUT` | `/api/coordinates/:name` | Replaces the full `coordinates` JSONB blob for a schema slot. Used by the Koordinaten editor on save. |

---

*End of STATUS_REPORT.md*
