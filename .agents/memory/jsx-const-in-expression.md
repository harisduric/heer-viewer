---
name: JSX const declaration error
description: const/let/var declarations inside JSX expression braces {} are a Babel parse error
---

## Rule
Never write `{ const x = ...; expr }` inside JSX. JSX `{}` expects a single *expression*, not a statement block. Babel (used by Vite for HMR) rejects it even though `tsc --noEmit` may accept it silently (tsc has looser JSX parsing in some configs).

**Why:** This was the exact bug that broke Vite HMR for viewer.tsx — `const fitToWidth = ...` was placed inside a JSX ternary branch `{}`. TypeScript passed, Vite failed with "Unexpected token" on the `const` keyword.

## Fix
Hoist any computed values to the component body (before the `return`) or into an IIFE `(() => { const x = ...; return expr; })()` — but prefer hoisting to component scope for clarity.
