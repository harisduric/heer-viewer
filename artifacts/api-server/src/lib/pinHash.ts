import { createHmac } from "crypto";

/**
 * HMAC-SHA256 of ACCESS_PIN keyed by SESSION_SECRET.
 * Stored as the signed-cookie value — when ACCESS_PIN changes, the hash
 * changes, so all previously issued cookies become invalid immediately.
 */
export function pinHash(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return createHmac("sha256", secret ?? "dev-fallback-only")
    .update(process.env.ACCESS_PIN ?? "")
    .digest("hex");
}
