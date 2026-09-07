import { Router } from "express";
import * as ctrl from "./courier.controller";
import { requireAuth, attachUserIfPresent } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { createCourierSchema, updateCourierSchema, compareCouriersQuerySchema } from "../../schemas/courier.schema";
import { idParamSchema } from "../../schemas/product.schema";

const router = Router();

router.get("/", attachUserIfPresent, ctrl.listCouriers);
router.get("/compare", attachUserIfPresent, validate({ query: compareCouriersQuerySchema }), ctrl.compareCouriers);
router.post("/", ...requireAuth, requireRole("admin"), validate({ body: createCourierSchema }), ctrl.createCourier);
router.patch("/:id", ...requireAuth, requireRole("admin"), validate({ params: idParamSchema, body: updateCourierSchema }), ctrl.updateCourier);

export default router;
