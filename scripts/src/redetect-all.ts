import { eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { schemasTable } from "@workspace/db";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const db = drizzle(client);

const rows = await db
  .select({ name: schemasTable.name })
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

for (const { name } of rows) {
  const url = `http://localhost:80/api/schema/${encodeURIComponent(name)}/redetect`;
  try {
    const res = await fetch(url, { method: "POST" });
    if (res.ok) {
      const body = (await res.json()) as { count?: number; summary?: string; rotationLog?: string };
      console.log(`✓ ${name} — ${body.count ?? 0} label(s) · ${body.summary ?? ""} · ${body.rotationLog ?? ""}`);
      successCount++;
    } else {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      console.error(`✗ ${name} — HTTP ${res.status}: ${body.error ?? res.statusText}`);
      failCount++;
    }
  } catch (err) {
    console.error(`✗ ${name} — fetch error: ${err instanceof Error ? err.message : String(err)}`);
    failCount++;
  }
}

await client.end();

console.log(`\nDone. ${successCount} succeeded, ${failCount} failed.`);
if (failCount > 0) process.exit(1);
