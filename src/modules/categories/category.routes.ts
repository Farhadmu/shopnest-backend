import { Router } from "express";
import * as ctrl from "./category.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { createCategorySchema, updateCategorySchema } from "../../schemas/category.schema";
import { idParamSchema } from "../../schemas/product.schema";

const router = Router();

router.get("/", ctrl.listCategories);
router.get("/:id", validate({ params: idParamSchema }), ctrl.getCategory);

router.post(
  "/",
  ...requireAuth,
  requireRole("admin"),
  validate({ body: createCategorySchema }),
  ctrl.createCategory
);
router.put(
  "/:id",
  ...requireAuth,
  requireRole("admin"),
  validate({ params: idParamSchema, body: updateCategorySchema }),
  ctrl.updateCategory
);
router.delete("/:id", ...requireAuth, requireRole("admin"), validate({ params: idParamSchema }), ctrl.deleteCategory);

export default router;
