import { Router } from "express";
import * as ctrl from "./return-eligibility.controller";
import { requireAuth, attachUserIfPresent } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { eligibilityParamsSchema, bulkCheckEligibilitySchema } from "../../schemas/return-eligibility.schema";

const router = Router();

router.get("/:orderId/:productId", attachUserIfPresent, validate({ params: eligibilityParamsSchema }), ctrl.checkReturnEligibility);
router.post("/check", ...requireAuth, validate({ body: bulkCheckEligibilitySchema }), ctrl.bulkCheckEligibility);

export default router;
