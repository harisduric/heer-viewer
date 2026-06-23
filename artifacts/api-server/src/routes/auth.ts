import { Router } from "express";
import type { IRouter } from "express";

const router: IRouter = Router();

/** GET /api/auth/session — 200 if session is valid, 401 otherwise.
 *  Returns { authDisabled: true } when ACCESS_PIN is not set. */
router.get("/auth/session", (req, res) => {
  if (!process.env.ACCESS_PIN) {
    res.json({ ok: true, authDisabled: true });
    return;
  }
  if (req.signedCookies?.heer_session === "authenticated") {
    res.json({ ok: true });
    return;
  }
  res.status(401).json({ error: "Nicht angemeldet" });
});

/** POST /api/auth/unlock — validate PIN, set 30-day signed session cookie. */
router.post("/auth/unlock", (req, res) => {
  if (!process.env.ACCESS_PIN) {
    res.cookie("heer_session", "authenticated", cookieOpts());
    res.json({ ok: true });
    return;
  }

  const submitted = String(req.body?.pin ?? "").trim();
  if (submitted !== process.env.ACCESS_PIN) {
    res.status(401).json({ error: "Falscher PIN" });
    return;
  }

  res.cookie("heer_session", "authenticated", cookieOpts());
  res.json({ ok: true });
});

function cookieOpts() {
  return {
    signed: true,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
    sameSite: "strict" as const,
    path: "/",
  };
}

export default router;
