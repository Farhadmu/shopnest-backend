import { Router } from "express";
import * as ctrl from "./order.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { createOrderSchema, updateOrderStatusSchema } from "../../schemas/order.schema";
import { idParamSchema } from "../../schemas/product.schema";

const router = Router();

router.use(...requireAuth);

router.get("/", ctrl.getOrders);
router.post("/", validate({ body: createOrderSchema }), ctrl.createOrder);
router.get("/seller/mine", requireRole("seller", "admin"), ctrl.getSellerOrders);
router.get("/admin/all", requireRole("admin"), ctrl.listAllOrdersForAdmin);
router.get("/admin/stats", requireRole("admin"), ctrl.getAdminOrderStats);
router.get("/admin/search", requireRole("admin"), ctrl.searchAdminOrders);
router.get("/admin/search", requireRole("admin"), ctrl.searchAdminOrders);
router.patch("/:id/cancel", requireRole("admin"), ctrl.cancelOrderAdmin);
router.get("/:id", validate({ params: idParamSchema }), ctrl.getOrderById);
router.patch(
  "/:id/status",
  requireRole("seller", "admin"),
  validate({ params: idParamSchema, body: updateOrderStatusSchema }),
  ctrl.updateOrderStatus
);

export default router;
