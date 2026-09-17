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
import { getPublicHomepageCoupons } from "../modules/coupons/coupon.controller";
import { getPublicPlatformStats } from "../modules/reviews/review.controller";
import trustRoutes from "../modules/trust/trust.routes";
import securityRoutes from "../modules/security/security.routes";
import adminRoutes from "../modules/admin/admin.routes";
import aiRoutes from "../modules/ai/ai.routes";
import notificationRoutes from "../modules/notifications/notification.routes";
import customerRoutes from "../modules/customer/customer.routes";
import customerFeaturesRoutes from "../modules/customer/customer-features.routes";
import spendingAnalyticsRoutes from "../modules/customer/spending-analytics.routes";
import heroBannerRoutes from "../modules/hero-banners/hero-banner.routes";
import imageRoutes from "../modules/images/image.routes";
import stripeRoutes from "../payments/stripe/stripe.routes";
import sslcommerzRoutes from "../payments/sslcommerz/sslcommerz.route";
import deliveryRoutes from "../modules/delivery/delivery.routes";
import complaintRoutes from "../modules/complaints/complaint.routes";

const router = Router();

router.get("/health", (_req, res) =>
  res
    .status(200)
    .json({
      success: true,
      message: "OK",
      service: "shopnest-api",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    }),
);

router.use("/users", userRoutes);
router.use("/categories", categoryRoutes);
router.use("/products", productRoutes);
router.use("/sellers", sellerRoutes);
router.use("/cart", cartRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/orders", orderRoutes);
router.use("/reviews", reviewRoutes);
router.use("/coupons", couponRoutes);
  router.get("/homepage-coupons", getPublicHomepageCoupons);
  // Public social-proof aggregates for the marketing site (no auth).
  router.get("/platform-stats", getPublicPlatformStats);
  router.use("/trust", trustRoutes);
router.use("/security", securityRoutes);
router.use("/admin", adminRoutes);
router.use("/ai", aiRoutes);
router.use("/notifications", notificationRoutes);
router.use("/customer", customerRoutes);
router.use("/customer/features", customerFeaturesRoutes);
router.use("/customer/spending", spendingAnalyticsRoutes);
router.use("/hero-banners", heroBannerRoutes);
router.use("/images", imageRoutes);
router.use("/payment/stripe", stripeRoutes);
router.use("/payment/sslcommerz", sslcommerzRoutes);
router.use("/delivery", deliveryRoutes);
router.use(complaintRoutes);

export default router;
