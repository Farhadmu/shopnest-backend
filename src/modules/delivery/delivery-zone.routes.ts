import { Router } from "express";
import * as ctrl from "./delivery-zone.controller";
import { requireAuth, attachUserIfPresent } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { createDeliveryZoneSchema, updateDeliveryZoneSchema, idParamSchema } from "../../schemas/delivery-zone.schema";

const router = Router();

router.get("/", attachUserIfPresent, ctrl.listDeliveryZones);
router.post("/", ...requireAuth, requireRole("admin"), validate({ body: createDeliveryZoneSchema }), ctrl.createDeliveryZone);
router.patch("/:id", ...requireAuth, requireRole("admin"), validate({ params: idParamSchema, body: updateDeliveryZoneSchema }), ctrl.updateDeliveryZone);
router.delete("/:id", ...requireAuth, requireRole("admin"), validate({ params: idParamSchema }), ctrl.deleteDeliveryZone);

export default router;
