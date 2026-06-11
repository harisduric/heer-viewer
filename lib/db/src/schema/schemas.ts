import { pgTable, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const schemasTable = pgTable("schemas", {
  name: varchar("name", { length: 100 }).primaryKey(),
  object_path: varchar("object_path", { length: 500 }),
  uploaded_at: timestamp("uploaded_at"),
  coordinates: jsonb("coordinates"),
  status: varchar("status", { length: 20 }).default("missing"),
});

export type SchemaRecord = typeof schemasTable.$inferSelect;
export type InsertSchemaRecord = typeof schemasTable.$inferInsert;
