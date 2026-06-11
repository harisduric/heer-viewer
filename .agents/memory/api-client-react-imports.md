---
name: api-client-react barrel imports
description: Always import from the @workspace/api-client-react barrel, never from the deep src path
---

**Rule:** Import all hooks and types from `@workspace/api-client-react` (the barrel). Never import from `@workspace/api-client-react/src/generated/api.schemas` or similar deep paths.

```ts
// CORRECT
import type { ParsedExecution } from "@workspace/api-client-react";
import { useGetSchemaLibrary } from "@workspace/api-client-react";

// WRONG – TS2307 module not found
import type { ParsedExecution } from "@workspace/api-client-react/src/generated/api.schemas";
```

**Why:** The package.json `exports` only exposes `"."` → `./src/index.ts`. Deep paths are not exported and TypeScript cannot resolve them.

**How to apply:** Any new file that needs generated types should use the barrel import.
