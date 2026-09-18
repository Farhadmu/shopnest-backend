import { Router } from "express";
import * as ctrl from "./seller-returns.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

router.use(requireAuth);
router.use(requireRole("seller", "admin"));

router.get("/", ctrl.getSellerReturns);
router.get("/:id", ctrl.getSellerReturnDetails);
router.post("/:id/approve", ctrl.approveReturn);
router.post("/:id/reject", ctrl.rejectReturn);
router.post("/:id/inspect", ctrl.inspectReturn);
router.post("/:id/receive", ctrl.receiveReturn);
router.post("/:id/refund-process", ctrl.processRefund);

export default router;
