import { createRequire } from "module";

const _require = createRequire(import.meta.url);

interface PdfPageProxy {
  pageNumber: number;
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{
    items: Array<{
      str: string;
      transform: number[];
      /** Advance width of the text item in PDF user-space units (points). */
      width: number;
    }>;
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
  /** Rotation in degrees derived from the PDF text transform: atan2(t[1], t[0]).
   *  0 = horizontal, 90 = 90° CCW, -90 = 90° CW. Omitted when 0. */
  rotation?: number;
  /** Advance width of the glyph string in PDF user-space units (points).
   *  Comes directly from pdfjs item.width. Used to offset the value label
   *  past the end of the Lx text rather than from its start. */
  textWidth?: number;
}

export interface CropRegion {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  /** PDF page number this section's crop is on (1-indexed, default 2). */
  page?: number;
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
 * Squared Euclidean distance from point (px, py) to the nearest point on a
 * rectangle [xMin, xMax] × [yMin, yMax].  Returns 0 when the point is inside.
 */
function distSqToCropRect(
  px: number, py: number,
  xMin: number, xMax: number, yMin: number, yMax: number,
): number {
  const dx = Math.max(xMin - px, 0, px - xMax);
  const dy = Math.max(yMin - py, 0, py - yMax);
  return dx * dx + dy * dy;
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
 * Priority 2 — nearest crop boundary (when label misses all crops):
 *   Assign to the section whose crop rectangle is geometrically closest to the
 *   label.  This is far more reliable than Voronoi distance to hardcoded fallback
 *   centres because it correctly handles labels that sit just outside their crop
 *   (e.g. a dimension line that extends 2–3 pt past the crop boundary) and labels
 *   whose section crops have moved since the fallback centres were tuned.
 *
 * Priority 3 — Voronoi distance to fallback section centres:
 *   Used only when no crop data is configured at all (legacy schemas).
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
    return c ? [[sec, c] as [SectionKey, CropRegion]] : [];
  });

  if (cropEntries.length > 0) {
    const maxCropBottom = Math.max(...cropEntries.map(([, c]) => c.cropY + c.cropH));
    // Add a small margin (20pt) to get the estimated actual page height.
    // For A4 landscape (height=595pt), crops bottom out at ~575pt → margin≈20pt.
    const actualPageH = maxCropBottom + 20;
    const yOffset = DETECT_PAGE_H - actualPageH; // e.g. 842 - 595 = 247

    // Priority 1: strict crop containment
    for (const [sec, c] of cropEntries) {
      const detCropYMin = c.cropY + yOffset;
      const detCropYMax = c.cropY + c.cropH + yOffset;
      if (x >= c.cropX && x <= c.cropX + c.cropW && y >= detCropYMin && y <= detCropYMax) {
        return sec;
      }
    }

    // Priority 2: nearest crop boundary — handles labels just outside their crop
    // (dimension lines that extend past the crop edge, slight misalignments, etc.)
    let nearestSec: SectionKey = cropEntries[0][0];
    let nearestDSq = Infinity;
    for (const [sec, c] of cropEntries) {
      const detCropYMin = c.cropY + yOffset;
      const detCropYMax = c.cropY + c.cropH + yOffset;
      const dSq = distSqToCropRect(x, y, c.cropX, c.cropX + c.cropW, detCropYMin, detCropYMax);
      if (dSq < nearestDSq) { nearestDSq = dSq; nearestSec = sec; }
    }
    return nearestSec;
  }

  // Priority 3 (no crops configured): Voronoi distance to fallback centres
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
  const rawItems: Array<{
    str: string; x: number; y: number; fontSize: number;
    isRotated: boolean; rotation: number; textWidth: number;
    pageNum: number;
  }> = [];

  // Determine which pages to scan and which sections live on each page.
  // Defaults to page 2 for all sections when no cropMap/page field is provided
  // (backward compat: existing schemas without per-section page configuration).
  const pagesToScan = new Set<number>();
  const sectionsByPage = new Map<number, SectionKey[]>();
  for (const sec of SECTIONS) {
    const p = cropMap?.[sec]?.page ?? 2;
    pagesToScan.add(p);
    const existing = sectionsByPage.get(p) ?? [];
    existing.push(sec);
    sectionsByPage.set(p, existing);
  }

  try {
    await pdfParse(pdfBytes, {
      max: 0,
      pagerender: async (page) => {
        if (!pagesToScan.has(page.pageNumber)) return "";

        // DETECT_PAGE_H=842 must always be used here so that detection coordinates
        // are consistent with the viewer's yAdjust correction and the crop-containment
        // test in assignSection. Using vp.height (e.g. 595 for A4 landscape) shifts
        // every y-value by ~247 pts, causing labels near the page top to fail crop
        // containment and fall to wrong Voronoi assignments. Intentionally ignoring
        // vp.height — see FIXES.md §5.
        void page.getViewport({ scale: 1.0 }); // keep call so pdfjs caches layout
        const ph = DETECT_PAGE_H;

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
          // Rotation in degrees from the PDF transform matrix: atan2(b, a).
          // 0 = horizontal, 90 = 90° CCW, -90 = 90° CW.
          const rotation = Math.round(Math.atan2(t[1], t[0]) * (180 / Math.PI));

          rawItems.push({
            str: s,
            x: t[4],
            y: ph - t[5], // flip from PDF space (bottom-up) to screen space (top-down)
            fontSize,
            isRotated,
            rotation,
            textWidth: Number.isFinite(item.width) && item.width > 0 ? item.width : 0,
            pageNum: page.pageNumber,
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

    // Restrict section assignment to sections configured on the same page as this item.
    // When all sections are on page 2 (the common case) this is identical to the old
    // behaviour; it only diverges when a section is configured on a different page.
    const sectionsOnPage = sectionsByPage.get(item.pageNum) ?? [...SECTIONS];
    const filteredCropMap: Partial<Record<SectionKey, CropRegion>> = {};
    const filteredCentres: Record<SectionKey, PointCoord> = { ...FALLBACK_CENTRES };
    for (const s of sectionsOnPage) {
      if (cropMap?.[s]) filteredCropMap[s] = cropMap[s];
      filteredCentres[s] = sectionPos[s];
    }
    const sec = assignSection(item.x, item.y, filteredCropMap, filteredCentres);
    const coord: PointCoord = {
      x: Math.round(item.x),
      y: Math.round(item.y),
      ...(item.rotation !== 0 ? { rotation: item.rotation } : {}),
      ...(item.textWidth > 0 ? { textWidth: Math.round(item.textWidth * 100) / 100 } : {}),
    };

    // Normalize label key: "L09" → "L9", "L1" → "L1" (strip leading zeros).
    // The execution PDF parser does the same via parseInt, so keys always match.
    const normalizedLabel = `L${parseInt(item.str.slice(1), 10)}`;

    // Primary coord: first occurrence only (backward compat with koordinaten editor)
    if (!page2[sec][normalizedLabel]) {
      page2[sec][normalizedLabel] = coord;
    }

    // All occurrences (for duplicate coverage in overlay)
    if (!page2_all[sec][normalizedLabel]) {
      page2_all[sec][normalizedLabel] = [];
    }
    page2_all[sec][normalizedLabel].push(coord);
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
