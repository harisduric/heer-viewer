# Heer Viewer

A production-floor tablet/PC web app for B. Heer AG Verpackungen that parses execution-description PDFs, matches them to schema drawings, overlays dimension values on each page, and guides users step-by-step.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/heer-viewer run dev` — run the frontend (dynamic port)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Wouter (routing) + Zustand (state) + TanStack Query
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- PDF rendering: pdfjs-dist v5+
- File storage: Replit Object Storage

## Where things live

- `lib/db/src/schema/schemas.ts` — DB schema (schemasTable, 17 canonical schema slots)
- `lib/db/src/seed.ts` — SLOT_NAMES array (17 names, sorted longest-first)
- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/api-client-react/src/generated/` — generated hooks + Zod schemas (do not edit)
- `artifacts/api-server/src/routes/` — execution.ts, schemas.ts, coordinates.ts
- `artifacts/heer-viewer/src/pages/` — import.tsx, viewer.tsx, bibliothek.tsx, koordinaten.tsx
- `artifacts/heer-viewer/src/components/` — layout.tsx, pdf-viewer.tsx, icons.tsx
- `artifacts/heer-viewer/src/store.ts` — Zustand store (parsedExecution state)

## Architecture decisions

- Contract-first: OpenAPI → Orval generates React Query hooks; server uses Zod schemas for validation.
- pdf-parse CJS import in ESM: must use `createRequire(import.meta.url)` to require it.
- pdfjs-dist v5+ `page.render()` requires an explicit `canvas: HTMLCanvasElement` property alongside `canvasContext`.
- All types exported from `@workspace/api-client-react` barrel; never import from the deep `src/generated/` path.
- Schema PDF uploads go to object storage; the API streams them back as ArrayBuffer for client-side pdfjs rendering.

## Product

- **Import**: drag-and-drop execution PDF → server parses dimensions + ANO codes, matches to one of 17 canonical schemas, redirects to Viewer.
- **Viewer**: 5–6 step workflow (Übersicht → BO/SE/KS/DE → Hebegurt if applicable). Each step renders the matching schema PDF page with dimension values overlaid at configured coordinates.
- **Bibliothek**: upload/manage the 17 schema PDFs; each card shows a live thumbnail.
- **Koordinaten**: admin tool to place/drag dimension label coordinates on schema PDF pages.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `pnpm --filter @workspace/db run push` must be run after schema changes.
- After `codegen`, no extra `typecheck:libs` step is needed.
- `@workspace/api-zod` tsconfig needs `"lib": ["es2022", "dom"]` for File/Blob types.
- Never import from `@workspace/api-client-react/src/generated/*` — use the barrel `@workspace/api-client-react`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `attached_assets/spec_1781158549286.md` for the full product specification
