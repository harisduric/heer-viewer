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

export interface CropRegion {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

export interface DetectionResult {
  page2: {
    BO: Record<string, PointCoord>;
    SE: Record<string, PointCoord>;
    KS: Record<string, PointCoord>;
    DE: Record<string, PointCoord>;
  };
  /** All occurrences of each label per section (for covering duplicate text). */
  page2_all: {
    BO: Record<string, PointCoord[]>;
    SE: Record<string, PointCoord[]>;
    KS: Record<string, PointCoord[]>;
    DE: Record<string, PointCoord[]>;
  };
  summary: string;
  count: number;
  /** "normal:N rotated:M" — how many L-label items had rotation vs not */
  rotationLog: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTIONS = ["BO", "SE", "KS", "DE"] as const;
type SectionKey = (typeof SECTIONS)[number];

const L_RE = /^L\d{1,2}$/;

// Detection fallback page height (pdf-parse vp.height is often undefined).
// Coordinates are stored as: y_stored = DETECT_PAGE_H - PDF_y
const DETECT_PAGE_H = 842;

// Fallback section centres in detection coordinate space (y = 842 - PDF_y).
// These original values worked well for the Voronoi fallback:
//   SE(115,220) pulls labels on the left half into SE
//   KS(310,220) pulls labels in the centre-left region (x≈300-350) into KS
//   BO(492,220) pulls labels on the right into BO
//   DE(195,610) pulls labels in the lower part into DE
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

/**
 * Assign a label position to a section.
 *
 * Priority 1 — crop containment (most reliable for non-overlapping sections):
 *   The crop regions are stored in pdfjs screen space (Y from top, range 0..actualPageH).
 *   Detection coordinates use Y = DETECT_PAGE_H − PDF_y.
 *   To compare them we shift crop Y by yOffset = DETECT_PAGE_H − actualPageH.
 *   actualPageH is estimated from the highest crop bottom edge + a small margin.
 *
 * Priority 2 — Voronoi distance to fallback section centres (detection space).
 */
function assignSection(
  x: number,
  y: number,
  cropMap: Partial<Record<SectionKey, CropRegion>>,
  centres: Record<SectionKey, PointCoord>
): SectionKey {
  // Estimate actual page height from the crop regions so we can convert their
  // pdfjs-space Y coordinates to detection-space Y (842-flip space).
  const cropEntries = SECTIONS.flatMap((sec) => {
    const c = cropMap[sec];
    return c ? [c] : [];
  });

  if (cropEntries.length > 0) {
    const maxCropBottom = Math.max(...cropEntries.map((c) => c.cropY + c.cropH));
    // Add a small margin (20pt) to get the estimated actual page height.
    // For A4 landscape (height=595pt), crops bottom out at ~575pt → margin≈20pt.
    const actualPageH = maxCropBottom + 20;
    const yOffset = DETECT_PAGE_H - actualPageH; // e.g. 842 - 595 = 247

    for (const sec of SECTIONS) {
      const c = cropMap[sec];
      if (!c) continue;
      // Convert pdfjs crop boundaries to detection coordinate space
      const detCropYMin = c.cropY + yOffset;
      const detCropYMax = c.cropY + c.cropH + yOffset;
      if (x >= c.cropX && x <= c.cropX + c.cropW && y >= detCropYMin && y <= detCropYMax) {
        return sec;
      }
    }
  }

  // Fall back to nearest section centre by Euclidean distance
  let nearest: SectionKey = "SE";
  let nearestD = Infinity;
  for (const sec of SECTIONS) {
    const d = dist2(x, y, centres[sec].x, centres[sec].y);
    if (d < nearestD) { nearestD = d; nearest = sec; }
  }
  return nearest;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * @param pdfBytes  Raw PDF buffer
 * @param cropMap   Existing page2_crops in pdfjs screen-space.
 *                  When provided, crop-based section assignment is used first
 *                  (most accurate). Falls back to Voronoi when label is outside
 *                  all crop regions.
 */
export async function detectLabelsFromPdf(
  pdfBytes: Buffer,
  cropMap?: Partial<Record<SectionKey, CropRegion>>
): Promise<DetectionResult> {
  const rawItems: Array<{ str: string; x: number; y: number; fontSize: number; isRotated: boolean }> = [];
  let pageH = DETECT_PAGE_H;

  try {
    await pdfParse(pdfBytes, {
      max: 0,
      pagerender: async (page) => {
        if (page.pageNumber !== 2) return "";

        const vp = page.getViewport({ scale: 1.0 });
        // vp.height is undefined in some pdf-parse pdfjs builds — guard it.
        // If it IS defined, it gives the actual page height which would shift the
        // coordinate system. Only use it when valid.
        if (Number.isFinite(vp.height)) pageH = vp.height;

        const content = await page.getTextContent();
        for (const item of content.items) {
          const s = item.str?.trim();
          if (!s) continue;
          const t = item.transform;
          // Guard: TextMarkedContent items have no transform; some PDFs produce
          // partial arrays or NaN values (typeof NaN === "number"!).
          if (
            !Array.isArray(t) ||
            t.length < 6 ||
            !Number.isFinite(t[4]) ||
            !Number.isFinite(t[5])
          ) continue;

          // Rotation-aware font size: for normal text t[0]≈fontSize, t[1]≈0.
          // For 90° rotated text t[0]≈0, t[1]≈fontSize. Math.hypot handles both.
          const fontSize = Math.hypot(t[0], t[1]);
          // Text is rotated ≥45° when the sin component dominates the cos component.
          const isRotated = Math.abs(t[1]) > Math.abs(t[0]);

          rawItems.push({
            str: s,
            x: t[4],
            y: pageH - t[5], // flip from PDF space (bottom-up) to screen space (top-down)
            fontSize,
            isRotated,
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
  // (section headers are printed larger than inline L-labels).

  const sectionPos: Record<SectionKey, PointCoord> = { ...FALLBACK_CENTRES };

  for (const sec of SECTIONS) {
    const hits = rawItems
      .filter((item) => item.str === sec)
      .sort((a, b) => b.fontSize - a.fontSize);
    if (hits.length > 0) {
      sectionPos[sec] = { x: hits[0].x, y: hits[0].y };
    }
  }

  // ── Assign L-labels to sections ────────────────────────────────────────────
  // Store ALL occurrences per label per section (not just the first).
  // This lets the viewer cover every duplicate text instance on the drawing.

  const page2: Record<SectionKey, Record<string, PointCoord>> = {
    BO: {}, SE: {}, KS: {}, DE: {},
  };
  const page2_all: Record<SectionKey, Record<string, PointCoord[]>> = {
    BO: {}, SE: {}, KS: {}, DE: {},
  };

  let normalCount = 0;
  let rotatedCount = 0;

  for (const item of rawItems) {
    if (!L_RE.test(item.str)) continue;

    if (item.isRotated) rotatedCount++; else normalCount++;

    const sec = assignSection(item.x, item.y, cropMap ?? {}, sectionPos);
    const coord: PointCoord = { x: Math.round(item.x), y: Math.round(item.y) };

    // Primary coord: first occurrence only (backward compat with koordinaten editor)
    if (!page2[sec][item.str]) {
      page2[sec][item.str] = coord;
    }

    // All occurrences (for duplicate coverage in overlay)
    if (!page2_all[sec][item.str]) {
      page2_all[sec][item.str] = [];
    }
    page2_all[sec][item.str].push(coord);
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
    page2_all,
    summary: summaryParts.length ? summaryParts.join(" · ") : "Keine Labels erkannt",
    count,
    rotationLog: `normal:${normalCount} rotated:${rotatedCount}`,
  };
}
