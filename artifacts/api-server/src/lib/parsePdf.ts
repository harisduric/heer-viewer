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
  const lines = pdfText
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
      if (rawValue && rawValue !== "0") {
        result.anoCodes.push({ section, optionCode, value: rawValue });
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
