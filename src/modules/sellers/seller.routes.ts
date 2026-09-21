import { Router } from "express";
import * as ctrl from "./seller.controller";
import * as followCtrl from "./store-follow.controller";
import sellerIntelligenceRoutes from "./seller-intelligence.routes";
import profitCalculatorRoutes from "./profit-calculator.routes";
import sellerReturnsRoutes from "./seller-returns.routes";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { registerStoreSchema, updateStoreSchema } from "../../schemas/seller.schema";

const router = Router();

// Public storefront routes (must be before wildcard sub-routes)
router.get("/stores/:storeId", ctrl.getStoreById);
router.get("/", ctrl.listStores);

// Store follow routes
router.get("/stores/:storeId/follow", ...requireAuth, followCtrl.getFollowStatus);
router.post("/stores/:storeId/follow", ...requireAuth, followCtrl.followStore);
router.delete("/stores/:storeId/follow", ...requireAuth, followCtrl.unfollowStore);

// Seller Account / Store management
router.post("/register", ...requireAuth, validate({ body: registerStoreSchema }), ctrl.registerStore);
router.get("/me", ...requireAuth, ctrl.getMyStore);
router.patch("/me", ...requireAuth, validate({ body: updateStoreSchema }), ctrl.updateMyStore);
router.post("/me/appeal", ...requireAuth, ctrl.submitStoreAppeal);
router.get("/metrics", ...requireAuth, requireRole("seller", "admin"), ctrl.getSellerMetrics);

// Sub-routes for Seller Intelligence & Growth Hub (auth-protected inside)
router.use("/", sellerIntelligenceRoutes);
router.use("/profit-calculator", profitCalculatorRoutes);
router.use("/returns", sellerReturnsRoutes);

export default router;
