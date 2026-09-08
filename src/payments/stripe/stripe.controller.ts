import { Request, Response } from "express";
import { stripeService } from "./stripe.service";
import stripe from "../../config/stripe";
import { handleStripePaymentSuccess } from "./payment-record.helper";

const createCheckoutSession = async (req: Request, res: Response) => {
  try {
    const { orderId, customerEmail } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const session = await stripeService.createCheckoutSession({
      orderId,
      customerEmail,
    });

    return res.status(200).json({
      success: true,
      message: "Checkout session created successfully",
      data: {
        sessionId: session.id,
        checkoutUrl: session.url,
      },
    });
  } catch (error) {
    console.error("Stripe checkout session error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to create checkout session",
    });
  }
};

const verifyCheckoutSession = async (req: Request, res: Response) => {
  try {
    const sessionId = (req.query.sessionId || req.body.sessionId) as string;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID is required",
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Checkout session not found",
      });
    }

    if (session.payment_status === "paid") {
      const { order, paymentRecord } = await handleStripePaymentSuccess(session);

      return res.status(200).json({
        success: true,
        message: "Payment verified successfully",
        data: {
          orderId: order._id.toString(),
          paymentStatus: order.paymentStatus,
          orderStatus: order.status,
          transactionId: paymentRecord.transactionId,
          amount: paymentRecord.amount,
          customerEmail:
            session.customer_details?.email || session.customer_email || "",
          order: order.toJSON(),
        },
      });
    }

    return res.status(400).json({
      success: false,
      message: `Payment not completed. Current status: ${session.payment_status}`,
    });
  } catch (error) {
    console.error("Stripe verify session error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to verify checkout session",
    });
  }
};

export const stripeController = {
  createCheckoutSession,
  verifyCheckoutSession,
};