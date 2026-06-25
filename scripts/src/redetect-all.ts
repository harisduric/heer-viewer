/**
 * Re-detect label positions for all uploaded schemas directly (no HTTP, no auth).
 * Imports detection logic from the api-server lib via relative path so it runs
 * with the same algorithm as the server without needing a running HTTP server.
 *
 * Usage:  pnpm --filter @workspace/scripts run redetect-all
 */

import { eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { schemasTable } from "@workspace/db";
import { detectLabelsFromPdf } from "../../artifacts/api-server/src/lib/detectLabels.js";
import { streamSchemaPdf } from "../../artifacts/api-server/src/lib/gcsStorage.js";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const db = drizzle(client);

const rows = await db
  .select()
  .from(schemasTable)
  .where(isNotNull(schemasTable.object_path));

if (rows.length === 0) {
  console.log("No schemas with uploaded PDFs found.");
  await client.end();
  process.exit(0);
}

console.log(`Re-detecting labels for ${rows.length} schema(s)...\n`);

let successCount = 0;
let failCount = 0;

for (const row of rows) {
  const { name } = row;
  try {
    const stream = await streamSchemaPdf(row.object_path!);
    if (!stream) {
      console.warn(`⚠ ${name} — PDF not found in storage, skipping`);
      failCount++;
      continue;
    }

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const pdfBytes = Buffer.concat(chunks);

    const currentCoords = (row.coordinates ?? {}) as Record<string, unknown>;
    const existingCrops = currentCoords["page2_crops"] as
      | Record<string, { cropX: number; cropY: number; cropW: number; cropH: number }>
      | undefined;

    const detection = await detectLabelsFromPdf(pdfBytes, existingCrops);

    const merged = {
      ...currentCoords,
      page2: detection.page2,
      page2_all: detection.page2_all,
    };

    await db
      .update(schemasTable)
      .set({ coordinates: merged })
      .where(eq(schemasTable.name, name));

    const secSummary = (["BO", "SE", "KS", "DE"] as const)
      .map((sec) => {
        const n = Object.keys(detection.page2[sec]).length;
        return n ? `${sec}:${n}` : null;
      })
      .filter(Boolean)
      .join(" ");

    console.log(`✓ ${name} — ${detection.count} label(s) [${secSummary}] · ${detection.rotationLog ?? ""}`);
    successCount++;
  } catch (err) {
    console.error(`✗ ${name} — ${err instanceof Error ? err.message : String(err)}`);
    failCount++;
  }
}

await client.end();

console.log(`\nDone. ${successCount} succeeded, ${failCount} failed.`);
if (failCount > 0) process.exit(1);
