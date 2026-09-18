import { Router } from "express";
import * as ctrl from "./seller-returns.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

router.use(requireAuth);
router.use(requireRole("seller", "admin"));

router.get("/returns", ctrl.getSellerReturns);
router.get("/returns/:id", ctrl.getSellerReturnDetails);
router.post("/returns/:id/approve", ctrl.approveReturn);
router.post("/returns/:id/reject", ctrl.rejectReturn);
router.post("/returns/:id/inspect", ctrl.inspectReturn);
router.post("/returns/:id/receive", ctrl.receiveReturn);
router.post("/returns/:id/refund-process", ctrl.processRefund);

export default router;
