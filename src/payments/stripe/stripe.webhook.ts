import { Router } from "express";
import stripe from "../../config/stripe";
import { handleStripePaymentSuccess } from "./payment-record.helper";

const router = Router();

router.post("/", async (req, res) => {
  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return res.status(400).json({
      success: false,
      message: "Stripe signature is missing",
    });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const result = await handleStripePaymentSuccess(session);

        console.log("Payment successful & record saved:", {
          paymentRecordId: result.paymentRecord._id.toString(),
          orderId: result.order._id.toString(),
          sessionId: session.id,
          amountTotal: session.amount_total,
          currency: session.currency,
        });

        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object;

        console.log("Checkout session expired:", {
          sessionId: session.id,
          orderId: session.metadata?.orderId,
        });

        break;
      }

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    console.error("Stripe webhook error:", error);

    return res.status(400).json({
      success: false,
      message: "Webhook verification failed",
    });
  }
});

export default router;