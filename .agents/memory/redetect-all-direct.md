---
name: redetect-all script bypasses HTTP auth
description: scripts/src/redetect-all.ts now imports detectLabels + gcsStorage directly; avoids session-cookie auth
---

## Rule
`pnpm --filter @workspace/scripts run redetect-all` invokes detection **directly** — it imports:
- `detectLabelsFromPdf` from `../../artifacts/api-server/src/lib/detectLabels.js`
- `streamSchemaPdf` from `../../artifacts/api-server/src/lib/gcsStorage.js`

It connects to the DB via `DATABASE_URL` and updates each schema in-place without going through the HTTP API.

**Why:** The `/api/schema/:name/redetect` endpoint is behind `requireSession` middleware (ACCESS_PIN cookie). Scripts cannot obtain a valid session cookie without knowing the PIN at runtime. The old version of redetect-all.ts made HTTP calls that returned 401. Importing the lib directly bypasses auth entirely and is always available.

**How to apply:** After any change to `detectLabels.ts` or `parsePdf.ts`, run the script to refresh all 17 schema coordinate datasets. tsx resolves the relative imports at runtime via Node.js module resolution from the workspace root node_modules.
