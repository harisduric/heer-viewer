export interface ParsedExecution {
  globalDimensions: Record<string, string>;
  sections: {
    BO: Record<string, string>;
    SE: Record<string, string>;
    KS: Record<string, string>;
    DE: Record<string, string>;
  };
  anoCodes: Array<{ section: string; optionCode: string; value: string }>;
}

export const SLOT_NAMES = [
  "PLK_W-BO_G-MV_AL",
  "PLK_W-BO_G-OV_AL",
  "PLK_W-BO_G-MV_IL",
  "PLK_W-BO_G-OV_IL",
  "LAV_W-BO_G-MV_AL",
  "LAV_W-BO_G-OV_AL",
  "VHK_W-BO_G-MV_AL",
  "VHK_W-BO_G-OV_AL",
  "PLK_W-BO_LBB_IL",
  "PLK_W-BO_KUF-LB_IL",
  "PLK_PLBO_KUF_IL",
  "BASIC",
  "PLK_W-BO_N_IL",
  "VHK_VHBO_N_IL",
  "VHB_PAL_W-BO",
  "SPEDI-BOX-FLEX_QBB",
  "SPEDI-BOX-FLEX_KUF",
];

const SLOT_NAMES_SORTED = [...SLOT_NAMES].sort((a, b) => b.length - a.length);

export function matchSchemaName(filename: string): string | null {
  const base = filename.replace(/\.pdf$/i, "");
  return SLOT_NAMES_SORTED.find((name) => base.includes(name)) ?? null;
}

export function parseExecutionDescription(pdfText: string): ParsedExecution {
  // Normalize line endings: pdf-parse inserts \x0c (form feed) between pages,
  // and some PDFs use \r\n or bare \r.  Convert all of these to plain \n so
  // the downstream split("\n") sees consistent line boundaries across pages.
  const cleanText = pdfText.replace(/\r\n/g, "\n").replace(/[\r\x0c]/g, "\n");

  // pdf-parse sometimes fuses consecutive entries onto the same line,
  // either via whitespace ("...LEER KS - L03...") or with no separator
  // at all when a page break falls mid-record ("...12DE - ANO_CODE...").
  //
  // Strategy: insert \n before any known section prefix that is NOT
  // already at the start of a line (i.e. preceded by any non-newline
  // character).  The lookahead guards against false positives by
  // requiring the prefix to be followed by " - ".
  //
  // Replacement "\n$1" keeps the prefix itself; the character before
  // the prefix (whitespace or value digit) is NOT consumed and stays
  // on the previous line where filter(Boolean) will discard it if it
  // produces an empty / too-short line.
  const normalized = cleanText.replace(
    /(?<=[^\n])(IM|AM|LM|U_QUE|BO\d*|SE\d*|KS\d*|DE\d*)(?= - )/g,
    "\n$1"
  );
  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const result: ParsedExecution = {
    globalDimensions: {},
    sections: { BO: {}, SE: {}, KS: {}, DE: {} },
    anoCodes: [],
  };

  const globalPrefixes = ["IM", "AM", "LM", "U_QUE"];

  for (const line of lines) {
    if (
      line.startsWith("- - -") ||
      line.startsWith("Nr.") ||
      line.startsWith("SCHEMA") ||
      line.startsWith("STANDARD") ||
      line.includes("Ausführungsbeschreibung")
    ) {
      continue;
    }

    const parts = line.split(" - ").map((p) => p.trim());
    if (parts.length < 3) continue;

    const [rawSection, code, ...rest] = parts;
    const section = rawSection.replace(/\d+$/, "");
    const rawValue = rest[rest.length - 1];

    if (code === "ANO_CODE") {
      const optionCode = rest[0];
      // Use the first purely-numeric non-"0" token from rest as the value.
      // Some PDFs add trailing fields after the ANO_CODE value (e.g. a "0"
      // sub-code), so taking rest[last] would incorrectly yield "0".
      const anoValue = rest.find((v) => /^\d+$/.test(v) && v !== "0") ?? "0";
      if (anoValue !== "0") {
        result.anoCodes.push({ section, optionCode, value: anoValue });
      }
      continue;
    }

    if (code === "LEER" || !rawValue || rawValue === "0") continue;

    if (globalPrefixes.some((p) => rawSection.startsWith(p))) {
      const key = `${rawSection}-${code}`;
      result.globalDimensions[key] = rawValue;
      continue;
    }

    if (
      (["BO", "SE", "KS", "DE"] as const).includes(
        section as "BO" | "SE" | "KS" | "DE"
      ) &&
      /^L\d{2}$/.test(code)
    ) {
      const label = `L${parseInt(code.replace("L", ""), 10)}`;
      result.sections[section as keyof typeof result.sections][label] =
        rawValue;
    }
  }

  return result;
}
