---
name: Generated hook queryKey requirement
description: Orval-generated TanStack Query hooks require queryKey in query options — passing only enabled: boolean causes a TS error.
---

When calling a generated hook such as `useGetSchemaPageCount(name, { query: { enabled: ... } })`, TypeScript errors with "Property 'queryKey' is missing in type". Always include the matching `getGet*QueryKey(...)` function alongside `enabled`.

**Why:** The generated `UseQueryOptions` type marks `queryKey` as required in this project's Orval/TanStack Query v5 configuration.

**How to apply:** For every generated hook call that passes a `query` options object, add `queryKey: getGet<HookName>QueryKey(...args)` next to `enabled`.
