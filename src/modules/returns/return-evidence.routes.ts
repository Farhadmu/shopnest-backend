import { Router } from "express";
import * as ctrl from "./return-evidence.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { submitReturnEvidenceSchema, returnIdParamSchema, orderIdParamSchema } from "../../schemas/return-evidence.schema";

const router = Router();

router.use(...requireAuth);

router.post("/", validate({ body: submitReturnEvidenceSchema }), ctrl.submitReturnEvidence);
router.get("/:returnId", validate({ params: returnIdParamSchema }), ctrl.getReturnEvidence);
router.get("/order/:orderId", validate({ params: orderIdParamSchema }), ctrl.getOrderEvidence);

export default router;
