import { Router, type IRouter } from "express";
import healthRouter from "./health";
import executionRouter from "./execution";
import schemasRouter from "./schemas";
import coordinatesRouter from "./coordinates";

const router: IRouter = Router();

router.use(healthRouter);
router.use(executionRouter);
router.use(schemasRouter);
router.use(coordinatesRouter);

export default router;
