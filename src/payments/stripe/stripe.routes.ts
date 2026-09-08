import { Router } from "express";
import { stripeController } from "./stripe.controller";

const router = Router();

router.post(
  "/create-checkout-session",
  stripeController.createCheckoutSession
);

router.get(
  "/verify-session",
  stripeController.verifyCheckoutSession
);

export default router;