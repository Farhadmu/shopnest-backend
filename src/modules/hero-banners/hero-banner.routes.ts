import { Router } from "express";
import * as ctrl from "./hero-banner.controller";
import { attachUserIfPresent, requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { heroBannerImageUpload } from "../../middlewares/upload.middleware";
import { validate } from "../../middlewares/validate.middleware";
import {
  createHeroBannerSchema,
  updateHeroBannerSchema,
  reorderHeroBannersSchema,
  heroBannerQuerySchema,
} from "../../schemas/hero-banner.schema";
import { idParamSchema } from "../../schemas/product.schema";

const router = Router();

router.get("/", attachUserIfPresent, validate({ query: heroBannerQuerySchema }), ctrl.listHeroBanners);
router.get("/:id", validate({ params: idParamSchema }), ctrl.getHeroBannerById);

router.post(
  "/upload",
  ...requireAuth,
  requireRole("admin"),
  heroBannerImageUpload.single("image"),
  ctrl.uploadHeroBannerImage
);

router.post(
  "/",
  ...requireAuth,
  requireRole("admin"),
  validate({ body: createHeroBannerSchema }),
  ctrl.createHeroBanner
);

router.put(
  "/:id",
  ...requireAuth,
  requireRole("admin"),
  validate({ params: idParamSchema, body: updateHeroBannerSchema }),
  ctrl.updateHeroBanner
);

router.delete("/:id", ...requireAuth, requireRole("admin"), validate({ params: idParamSchema }), ctrl.deleteHeroBanner);

router.patch(
  "/reorder",
  ...requireAuth,
  requireRole("admin"),
  validate({ body: reorderHeroBannersSchema }),
  ctrl.reorderHeroBanners
);

export default router;
