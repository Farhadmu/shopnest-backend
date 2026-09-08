import stripe from "../../config/stripe";
import { Order } from "../../modules/orders/order.model";

interface CreateCheckoutSessionData {
  orderId: string;
  customerEmail?: string;
}

const createCheckoutSession = async ({
  orderId,
  customerEmail,
}: CreateCheckoutSessionData) => {
  const order = await Order.findById(orderId);

  if (!order) {
    throw new Error("Order not found");
  }

  if (order.paymentStatus === "paid") {
    throw new Error("Order is already paid");
  }

  if (order.paymentMethod !== "stripe") {
    throw new Error("This order is not configured for Stripe payment");
  }

  const currency = process.env.STRIPE_CURRENCY || "bdt";

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],

    mode: "payment",

    customer_email: customerEmail,

    line_items: [
      {
        price_data: {
          currency,
          product_data: {
            name: `ShopNest Order #${order._id}`,
          },
          unit_amount: Math.round(order.totalAmount * 100),
        },
        quantity: 1,
      },
    ],

    metadata: {
      orderId: order._id.toString(),
    },

    success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,

    cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
  });

  return session;
};


export const stripeService = {
  createCheckoutSession,
};