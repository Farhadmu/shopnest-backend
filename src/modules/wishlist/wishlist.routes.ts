import { Router } from "express";
import * as ctrl from "./wishlist.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { addWishlistItemSchema } from "../../schemas/wishlist.schema";
import { productIdParamSchema } from "../../schemas/cart.schema";

const router = Router();
router.use(...requireAuth);

router.get("/", ctrl.getWishlist);
router.post("/items", validate({ body: addWishlistItemSchema }), ctrl.addWishlistItem);
router.delete("/items/:productId", validate({ params: productIdParamSchema }), ctrl.removeWishlistItem);

export default router;
