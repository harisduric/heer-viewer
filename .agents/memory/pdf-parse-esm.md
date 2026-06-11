---
name: pdf-parse in ESM api-server
description: pdf-parse is CJS; must use createRequire in the ESM server bundle
---

**Rule:** The api-server is built as ESM (`.mjs`). `pdf-parse` is a CJS module. Import it with `createRequire`:

```ts
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as typeof import("pdf-parse");
```

**Why:** A plain `import pdfParse from "pdf-parse"` fails at runtime because the package has no ESM entry. `createRequire` bridges CJS into ESM context.

**How to apply:** Any time pdf-parse (or another CJS-only package) is imported in an ESM artifact server, use this pattern.
