import { Router } from "express";
import userRoutes from "../modules/users/user.routes";
import categoryRoutes from "../modules/categories/category.routes";
import productRoutes from "../modules/products/product.routes";
import sellerRoutes from "../modules/sellers/seller.routes";
import cartRoutes from "../modules/cart/cart.routes";
import wishlistRoutes from "../modules/wishlist/wishlist.routes";
import orderRoutes from "../modules/orders/order.routes";
import reviewRoutes from "../modules/reviews/review.routes";
import couponRoutes from "../modules/coupons/coupon.routes";
import flashSaleRoutes from "../modules/campaigns/flashSale.routes";
import notificationRoutes from "../modules/notifications/notification.routes";
import trustRoutes from "../modules/trust/trust.routes";
import securityRoutes from "../modules/security/security.routes";
import adminRoutes from "../modules/admin/admin.routes";
import aiRoutes from "../modules/ai/ai.routes";

const router = Router();

router.get("/health", (_req, res) => res.status(200).json({ success: true, message: "OK" }));

router.use("/users", userRoutes);
router.use("/categories", categoryRoutes);
router.use("/products", productRoutes);
router.use("/sellers", sellerRoutes);
router.use("/cart", cartRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/orders", orderRoutes);
router.use("/reviews", reviewRoutes);
router.use("/coupons", couponRoutes);
router.use("/flash-sales", flashSaleRoutes);
router.use("/notifications", notificationRoutes);
router.use("/trust", trustRoutes);
router.use("/security", securityRoutes);
router.use("/admin", adminRoutes);
router.use("/ai", aiRoutes);

export default router;
