import { Router } from "express";
import { sslcommerzController } from "./sslcommerz.controller";

const router = Router();

router.post(
  "/create-payment-session",
  sslcommerzController.createPaymentSession
);

router.get(
  "/verify-payment",
  sslcommerzController.verifyPayment
);

router.post(
  "/verify-payment",
  sslcommerzController.verifyPayment
);

router.post(
  "/ipn",
  sslcommerzController.handleIPN
);

export default router;