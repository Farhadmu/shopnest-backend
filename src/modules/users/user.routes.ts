import { Router } from "express";
import * as ctrl from "./user.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { updateProfileSchema } from "../../schemas/user.schema";

const router = Router();

router.get("/profile", ...requireAuth, ctrl.getProfile);
router.patch("/profile", ...requireAuth, validate({ body: updateProfileSchema }), ctrl.updateProfile);

router.get("/", ...requireAuth, requireRole("admin"), ctrl.adminListUsers);
router.patch("/:id/status", ...requireAuth, requireRole("admin"), ctrl.adminSetUserStatus);

export default router;
