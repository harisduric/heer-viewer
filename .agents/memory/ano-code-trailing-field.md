---
name: ANO_CODE normalization regex false-positive
description: The normalization regex must use (?<=\d) not (?<=[^\n]) — the broad lookbehind matched "DE" inside "ANO_CODE" and silently destroyed all ANO_CODE entries.
---

## Rule
The normalization lookbehind in `parseExecutionDescription` MUST be `(?<=\d)`, not `(?<=[^\n])` or any variant that allows a letter/underscore before the match.

```typescript
// CORRECT
cleanText.replace(
  /(?<=\d)(IM|AM|LM|U_QUE|BO\d*|SE\d*|KS\d*|DE\d*)(?= - )/g,
  "\n$1"
)

// WRONG — do NOT use
// /(?<=[^\n])(IM|AM|LM|U_QUE|BO\d*|SE\d*|KS\d*|DE\d*)(?= - )/g
```

## Why
`DE\d*` is in the alternatives list. The string "ANO_CODE - Z01 - 11" contains "DE" at position 6 of "CODE". The "O" before "DE" is not a newline, so `(?<=[^\n])` **passes** and inserts `\n` inside "ANO_CODE":

```
"KS1 - ANO_CODE - Z01 - 11"
         ↓ becomes
"KS1 - ANO_CO\nDE - Z01 - 11"
```

After split+trim: `["KS1 - ANO_CO"` (2 parts, skipped), `"DE - Z01 - 11"` (code = "Z01", not "ANO_CODE", skipped)]. All 5 ANO_CODE entries are silently destroyed. `anoCodes = []` → `hasHebegurt = false`.

`(?<=\d)` restricts insertion to genuinely fused records (e.g. "12DE") where a numeric value tail immediately precedes the section prefix. The "O" before "DE" in "ANO_CODE" is a letter, not a digit — lookbehind fails correctly.

## How to apply
Any future change to the normalization regex in `parsePdf.ts → parseExecutionDescription` must preserve `(?<=\d)`. If you ever add a new section prefix to the alternatives, verify it does NOT appear as a substring of "ANO_CODE" or other common tokens.
