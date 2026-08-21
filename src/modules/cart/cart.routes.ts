import { Router } from "express";
import * as ctrl from "./cart.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { addCartItemSchema, productIdParamSchema, updateCartItemSchema } from "../../schemas/cart.schema";

const router = Router();

router.use(...requireAuth);

router.get("/", ctrl.getCart);
router.post("/items", validate({ body: addCartItemSchema }), ctrl.addCartItem);
router.patch("/items/:productId", validate({ params: productIdParamSchema, body: updateCartItemSchema }), ctrl.updateCartItem);
router.delete("/items/:productId", validate({ params: productIdParamSchema }), ctrl.removeCartItem);

export default router;
