import { Router } from "express";
import { chatDeliveryCopilot } from "./delivery-copilot.controller";
import { requireAuth } from "../../../middlewares/auth.middleware";
import { requireRole } from "../../../middlewares/role.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { deliveryCopilotQuerySchema } from "./delivery-copilot.schemas";

const router = Router();

router.use(...requireAuth);
router.post(
  "/chat",
  requireRole("delivery_man", "admin"),
  validate({ body: deliveryCopilotQuerySchema }),
  chatDeliveryCopilot
);

export default router;
