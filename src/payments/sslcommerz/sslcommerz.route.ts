import { Router } from "express";
import { sslcommerzController } from "./sslcommerz.controller";

const router = Router();

router.post(
  "/create-payment-session",
  sslcommerzController.createPaymentSession
);

export default router;