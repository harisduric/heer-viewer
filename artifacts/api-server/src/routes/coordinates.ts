import { Router } from "express";
import { db } from "@workspace/db";
import { schemasTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get(
  "/coordinates/:name",
  async (req, res): Promise<void> => {
    const name = req.params["name"] as string;

    const [row] = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.name, name))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Schema slot not found" });
      return;
    }

    res.json(row.coordinates ?? {});
  }
);

router.put(
  "/coordinates/:name",
  async (req, res): Promise<void> => {
    const name = req.params["name"] as string;
    const body = req.body as Record<string, unknown>;

    const [row] = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.name, name))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Schema slot not found" });
      return;
    }

    const [updated] = await db
      .update(schemasTable)
      .set({ coordinates: body })
      .where(eq(schemasTable.name, name))
      .returning();

    res.json(updated.coordinates ?? {});
  }
);

export default router;
