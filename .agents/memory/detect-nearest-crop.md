---
name: Detection section assignment nearest-crop fallback
description: assignSection priority order and why Voronoi was replaced by nearest-crop-boundary distance
---

## Rule
`assignSection` in `detectLabels.ts` uses three priority levels:
1. **Strict crop containment** — exact rectangle test (most accurate)
2. **Nearest crop boundary** — `distSqToCropRect` gives minimum squared distance from point to each crop rect; assign to closest
3. **Voronoi to hardcoded centres** — only when no cropMap data exists at all (legacy schemas)

Priority 2 replaced the old priority-2 (Voronoi) and fixes labels that fall just outside their section's crop boundary due to dimension lines extending past the edge or slight PDF layout shifts.

**Why:** The old Voronoi approach used hardcoded BO/SE/KS/DE centres tuned for one specific layout. When a label missed all crops it could jump to a completely unrelated section. For PLK_W-BO_G-OV_IL, BO labels L6/L7/L8 were falling in KS (BO:8 instead of BO:11). After switching to nearest-crop, BO:11 ✓.

**How to apply:** After any change to `assignSection` or cropMap structure, run `pnpm --filter @workspace/scripts run redetect-all` to refresh all 17 schemas. The redetect-all script now imports the detection lib directly (no HTTP auth required).
