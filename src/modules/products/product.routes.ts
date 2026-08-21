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
  updateProductSchema,
} from "../../schemas/product.schema";
import { createReviewSchema } from "../../schemas/review.schema";

const router = Router();

router.get("/", attachUserIfPresent, validate({ query: listProductsQuerySchema }), ctrl.listProducts);
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
