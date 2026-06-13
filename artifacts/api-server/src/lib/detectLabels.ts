import { createRequire } from "module";

const _require = createRequire(import.meta.url);

interface PdfPageProxy {
  pageNumber: number;
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{
    items: Array<{ str: string; transform: number[] }>;
  }>;
}

const pdfParse = _require("pdf-parse") as (
  buffer: Buffer,
  options?: {
    max?: number;
    pagerender?: (page: PdfPageProxy) => Promise<string>;
  }
) => Promise<{ text: string }>;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PointCoord {
  x: number;
  y: number;
}

export interface DetectionResult {
  page2: {
    BO: Record<string, PointCoord>;
    SE: Record<string, PointCoord>;
    KS: Record<string, PointCoord>;
    DE: Record<string, PointCoord>;
  };
  summary: string;
  count: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTIONS = ["BO", "SE", "KS", "DE"] as const;
type SectionKey = (typeof SECTIONS)[number];

const L_RE = /^L\d{1,2}$/;

// Fallback section centres (PDF screen-space, Y down) when no header text found
// Based on calibrated crop regions for 595×842 pt pages
const FALLBACK_CENTRES: Record<SectionKey, PointCoord> = {
  SE: { x: 115, y: 220 },
  KS: { x: 310, y: 220 },
  BO: { x: 492, y: 220 },
  DE: { x: 195, y: 610 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function detectLabelsFromPdf(pdfBytes: Buffer): Promise<DetectionResult> {
  const rawItems: Array<{ str: string; x: number; y: number; fontSize: number }> = [];
  let pageH = 842;

  try {
    await pdfParse(pdfBytes, {
      max: 0,
      pagerender: async (page) => {
        if (page.pageNumber !== 2) return "";

        const vp = page.getViewport({ scale: 1.0 });
        // vp.height may be undefined in some pdf-parse pdfjs builds — guard it
        if (Number.isFinite(vp.height)) pageH = vp.height;

        const content = await page.getTextContent();
        for (const item of content.items) {
          const s = item.str?.trim();
          if (!s) continue;
          const t = item.transform;
          // Guard: TextMarkedContent items have no transform; some PDFs produce
          // partial arrays or NaN values (typeof NaN === "number"!).
          // Number.isFinite rejects both non-numbers AND NaN/Infinity.
          if (
            !Array.isArray(t) ||
            t.length < 6 ||
            !Number.isFinite(t[4]) ||
            !Number.isFinite(t[5])
          ) continue;
          // t[4] = x in PDF space (left→right, same as screen)
          // t[5] = y in PDF space (bottom→top); flip to screen coords (top→down)
          rawItems.push({
            str: s,
            x: t[4],
            y: pageH - t[5],
            fontSize: Math.abs(t[0]), // t[0] ≈ font size (horizontal scale)
          });
        }
        return "";
      },
    });
  } catch {
    // Extraction failed — return empty result; upload still succeeds
  }

  // ── Find section header positions ──────────────────────────────────────────
  // For each of BO/SE/KS/DE, pick the text item with the largest font size
  // (section headers are printed larger than inline labels).

  const sectionPos: Record<SectionKey, PointCoord> = { ...FALLBACK_CENTRES };

  for (const sec of SECTIONS) {
    const hits = rawItems
      .filter((item) => item.str === sec)
      .sort((a, b) => b.fontSize - a.fontSize);
    if (hits.length > 0) {
      sectionPos[sec] = { x: hits[0].x, y: hits[0].y };
    }
  }

  // ── Assign L-labels to nearest section ─────────────────────────────────────

  const page2: Record<SectionKey, Record<string, PointCoord>> = {
    BO: {}, SE: {}, KS: {}, DE: {},
  };

  for (const item of rawItems) {
    if (!L_RE.test(item.str)) continue;

    let nearest: SectionKey = "SE";
    let nearestD = Infinity;
    for (const sec of SECTIONS) {
      const pos = sectionPos[sec];
      const d = dist2(item.x, item.y, pos.x, pos.y);
      if (d < nearestD) { nearestD = d; nearest = sec; }
    }

    // Keep first occurrence only (label text can appear twice on a dimension line)
    if (!page2[nearest][item.str]) {
      page2[nearest][item.str] = { x: Math.round(item.x), y: Math.round(item.y) };
    }
  }

  // ── Build summary ──────────────────────────────────────────────────────────

  const summaryParts: string[] = [];
  for (const sec of SECTIONS) {
    const labels = Object.keys(page2[sec]).sort(
      (a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1))
    );
    if (labels.length) summaryParts.push(`${sec}: ${labels.join(", ")}`);
  }

  const count = SECTIONS.reduce((n, sec) => n + Object.keys(page2[sec]).length, 0);

  return {
    page2,
    summary: summaryParts.length ? summaryParts.join(" · ") : "Keine Labels erkannt",
    count,
  };
}
