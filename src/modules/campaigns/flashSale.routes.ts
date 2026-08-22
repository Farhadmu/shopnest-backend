import { Router } from "express";
import * as ctrl from "./flashSale.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { createFlashSaleSchema } from "../../schemas/flashSale.schema";

const router = Router();

router.get("/active", ctrl.listActiveFlashSales);
router.get("/", ...requireAuth, requireRole("seller", "admin"), ctrl.listFlashSales);
router.post("/", ...requireAuth, requireRole("seller", "admin"), validate({ body: createFlashSaleSchema }), ctrl.createFlashSale);
router.delete("/:id", ...requireAuth, requireRole("seller", "admin"), ctrl.deleteFlashSale);

export default router;
