import { Router } from "express";
import * as ctrl from "./product.controller";
import * as reviewCtrl from "../reviews/review.controller";
import { attachUserIfPresent, requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import {
  createProductSchema,
  idParamSchema,
  listProductsQuerySchema,
  productCountsQuerySchema,
  updateFeaturedSchema,
  updateProductSchema,
} from "../../schemas/product.schema";
import { createReviewSchema } from "../../schemas/review.schema";

const router = Router();

router.get("/", attachUserIfPresent, validate({ query: listProductsQuerySchema }), ctrl.listProducts);
router.get("/stores/options", ctrl.getStoreOptions);
router.get("/sellers/options", ctrl.getSellerOptions);
router.get(
  "/categories/counts",
  validate({ query: productCountsQuerySchema }),
  ctrl.getCategoryCounts
);

// Trending and featured products must be registered BEFORE `:id` so it is not captured as a product id.
router.get("/compare", ctrl.getCompareProducts);
router.get("/trending", ctrl.getTrendingProducts);
router.get("/featured", ctrl.getFeaturedProducts);

// Seller's own catalog — ownership enforced server-side from the session.
router.get("/mine", ...requireAuth, requireRole("seller", "admin"), ctrl.listMyProducts);

router.get("/:id/recommendations", validate({ params: idParamSchema }), ctrl.getRecommendedProducts);
router.get("/:id/recommended", validate({ params: idParamSchema }), ctrl.getRecommendedProducts);

router.get("/:id", attachUserIfPresent, validate({ params: idParamSchema }), ctrl.getProductById);

router.post(
  "/",
  ...requireAuth,
  requireRole("seller", "admin"),
  validate({ body: createProductSchema }),
  ctrl.createProduct
);
router.put(
  "/:id",
  ...requireAuth,
  requireRole("seller", "admin"),
  validate({ params: idParamSchema, body: updateProductSchema }),
  ctrl.updateProduct
);
router.delete("/:id", ...requireAuth, requireRole("seller", "admin"), validate({ params: idParamSchema }), ctrl.deleteProduct);
router.patch("/:id/moderate", ...requireAuth, requireRole("admin"), validate({ params: idParamSchema }), ctrl.moderateProduct);
router.patch(
  "/:id/featured",
  ...requireAuth,
  requireRole("admin"),
  validate({ params: idParamSchema, body: updateFeaturedSchema }),
  ctrl.updateFeaturedProduct
);

// Nested reviews: GET/POST /products/:id/reviews
router.get("/:id/reviews", validate({ params: idParamSchema }), reviewCtrl.listProductReviews);
router.post(
  "/:id/reviews",
  ...requireAuth,
  requireRole("customer", "seller", "admin"),
  validate({ params: idParamSchema, body: createReviewSchema }),
  reviewCtrl.addProductReview
);

export default router;
