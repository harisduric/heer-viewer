import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import executionRouter from "./execution";
import schemasRouter from "./schemas";
import coordinatesRouter from "./coordinates";
import { requireSession } from "../middleware/requireSession";

const router: IRouter = Router();

// Public routes — no session required
router.use(authRouter);   // /auth/session, /auth/unlock
router.use(healthRouter); // /healthz

// Session gate — all routes below require a valid signed cookie
router.use(requireSession);

// Protected routes
router.use(executionRouter);
router.use(schemasRouter);
router.use(coordinatesRouter);

export default router;
