import type { Request, Response, NextFunction } from "express";
import { pinHash } from "../lib/pinHash";

/**
 * Blocks requests that don't carry a valid signed session cookie.
 * The cookie value is HMAC(ACCESS_PIN) so changing the PIN immediately
 * invalidates all existing sessions.
 * Skipped automatically when ACCESS_PIN is not configured (dev/test).
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.ACCESS_PIN) {
    next();
    return;
  }
  if (req.signedCookies?.heer_session === pinHash()) {
    next();
    return;
  }
  res.status(401).json({ error: "Nicht angemeldet" });
}
