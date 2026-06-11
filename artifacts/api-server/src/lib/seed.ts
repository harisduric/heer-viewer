import { db } from "@workspace/db";
import { schemasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SLOT_NAMES } from "./parsePdf";
import { logger } from "./logger";

function buildDefaultCoordinates() {
  const pt = (x = 100, y = 100) => ({ x, y });
  const label = () => pt();

  return {
    page1: {
      "IM-LÄNGE": label(),
      "AM-LÄNGE": label(),
      "IM-BREITE": label(),
      "AM-BREITE": label(),
      "IM-HÖHE": label(),
      "AM-HÖHE": label(),
      "LM-ZW QBB": label(),
      "U_QUE-MIN.580": label(),
    },
    page2_crops: {
      BO: { cropX: 600, cropY: 400, cropW: 500, cropH: 450 },
      SE: { cropX: 0, cropY: 400, cropW: 500, cropH: 450 },
      KS: { cropX: 300, cropY: 400, cropW: 300, cropH: 450 },
      DE: { cropX: 0, cropY: 0, cropW: 500, cropH: 400 },
    },
    page2: {
      BO: Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => [`L${i + 1}`, label()])
      ),
      SE: Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [`L${i + 1}`, label()])
      ),
      KS: Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`L${i + 1}`, label()])
      ),
      DE: Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [`L${i + 1}`, label()])
      ),
    },
    page3: {
      KS: {
        "11": { cropX: 0, cropY: 500, cropW: 400, cropH: 300 },
        "12": { cropX: 400, cropY: 500, cropW: 400, cropH: 300 },
        "21": { cropX: 0, cropY: 200, cropW: 400, cropH: 300 },
        "22": { cropX: 400, cropY: 200, cropW: 400, cropH: 300 },
      },
      SE: {
        "11": { cropX: 0, cropY: 500, cropW: 400, cropH: 300 },
        "12": { cropX: 400, cropY: 500, cropW: 400, cropH: 300 },
        "21": { cropX: 0, cropY: 200, cropW: 400, cropH: 300 },
        "22": { cropX: 400, cropY: 200, cropW: 400, cropH: 300 },
      },
      DE: {
        "11": { cropX: 0, cropY: 500, cropW: 400, cropH: 300 },
        "12": { cropX: 400, cropY: 500, cropW: 400, cropH: 300 },
        "21": { cropX: 0, cropY: 200, cropW: 400, cropH: 300 },
        "22": { cropX: 400, cropY: 200, cropW: 400, cropH: 300 },
      },
    },
  };
}

export async function seedSchemas(): Promise<void> {
  try {
    const existing = await db.select().from(schemasTable);
    const existingNames = new Set(existing.map((r) => r.name));

    const toInsert = SLOT_NAMES.filter((name) => !existingNames.has(name));

    if (toInsert.length === 0) {
      logger.info("Schema slots already seeded");
      return;
    }

    await db.insert(schemasTable).values(
      toInsert.map((name) => ({
        name,
        status: "missing",
        coordinates: buildDefaultCoordinates(),
      }))
    );

    logger.info({ count: toInsert.length }, "Seeded schema slots");
  } catch (err) {
    logger.error({ err }, "Failed to seed schema slots");
  }
}
