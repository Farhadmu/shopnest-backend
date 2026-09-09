import { Request, Response } from "express";
import { sslcommerzService } from "./sslcommerz.service";

const createPaymentSession = async (req: Request, res: Response) => {
  try {
    const { orderId, customerEmail } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const paymentSession = await sslcommerzService.createPaymentSession({
      orderId,
      customerEmail,
    });

    return res.status(200).json({
      success: true,
      message: "SSLCommerz payment session created successfully",
      data: paymentSession,
    });
  } catch (error) {
    console.error("SSLCommerz payment session error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to create SSLCommerz payment session",
    });
  }
};

export const sslcommerzController = {
  createPaymentSession,
};