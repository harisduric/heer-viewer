---
name: ANO_CODE trailing-field pitfall
description: parsePdf.ts must not take the last token of rest as the ANO_CODE value; LAV-type PDFs append a trailing "0" sub-field after the real value.
---

## Rule
For `ANO_CODE` lines in `parseExecutionDescription`, the value is the **first purely-numeric non-"0" token** in `rest`, not `rest[rest.length - 1]`.

```typescript
const anoValue = rest.find((v) => /^\d+$/.test(v) && v !== "0") ?? "0";
```

## Why
The LAV-family PDFs produce entries like:
```
KS1 - ANO_CODE - Z01 - 11 - 0
```
The last token is "0" (a trailing sub-field), NOT the ANO_CODE value "11".  
Taking `rest[rest.length - 1]` always yielded "0", so parsePdf.ts never pushed the entry and `anoCodes` stayed empty → `hasHebegurt` was always `false`.

PLK-family PDFs had all ANO_CODE = 0, so the bug was invisible until a LAV PDF was tested.

## How to apply
Always in `parsePdf.ts` → `parseExecutionDescription` → the `if (code === "ANO_CODE")` branch.  
Assumes option-code tokens (like "Z01") start with a letter and therefore don't match `/^\d+$/`.
