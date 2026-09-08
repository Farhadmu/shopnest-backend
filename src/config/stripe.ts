import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Stripe secret key is not defined");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default stripe;