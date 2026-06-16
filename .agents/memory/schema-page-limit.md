---
name: Schema page route upper limit
description: The schema page serving route had a hard cap at 10 pages; raised to 200 for Hebegurt multi-page PDFs.
---

`GET /api/schema/:name/page/:num` previously rejected page numbers > 10. This was fine when only crop-region steps were needed (pages 1–4 at most), but the Hebegurt step shows all pages from a configured start page through end of document, which can exceed 10.

**Why:** Old cap was a conservative guard written before Hebegurt multi-page support was designed. It silently returned 400 for any page > 10.

**How to apply:** Current limit is 200. If a real-world schema PDF ever exceeds 200 pages, raise the cap again in `artifacts/api-server/src/routes/schemas.ts`.
