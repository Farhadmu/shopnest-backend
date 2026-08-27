import { Router } from "express";
import * as ctrl from "./seller.controller";
import sellerIntelligenceRoutes from "./seller-intelligence.routes";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { registerStoreSchema, updateStoreSchema } from "../../schemas/seller.schema";

const router = Router();

// Sub-routes for Seller Intelligence & Growth Hub
router.use("/", sellerIntelligenceRoutes);

router.get("/stores/:storeId", ctrl.getStoreById);
router.get("/", ctrl.listStores);

router.post("/register", ...requireAuth, requireRole("customer", "seller"), validate({ body: registerStoreSchema }), ctrl.registerStore);
router.get("/me", ...requireAuth, requireRole("seller", "admin"), ctrl.getMyStore);
router.patch("/me", ...requireAuth, requireRole("seller", "admin"), validate({ body: updateStoreSchema }), ctrl.updateMyStore);
router.get("/metrics", ...requireAuth, requireRole("seller", "admin"), ctrl.getSellerMetrics);

export default router;
