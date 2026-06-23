import type { Request, Response, NextFunction } from "express";

/** Blocks requests that don't carry a valid signed session cookie.
 *  Skipped automatically when ACCESS_PIN is not configured (dev/test). */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.ACCESS_PIN) {
    next();
    return;
  }
  if (req.signedCookies?.heer_session === "authenticated") {
    next();
    return;
  }
  res.status(401).json({ error: "Nicht angemeldet" });
}
