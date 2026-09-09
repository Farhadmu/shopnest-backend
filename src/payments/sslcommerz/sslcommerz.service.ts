import sslcommerz from "../../config/sslcommerz";
import { Order } from "../../modules/orders/order.model";

interface CreateSSLCommerzSessionData {
  orderId: string;
  customerEmail?: string;
}

const createPaymentSession = async ({
  orderId,
  customerEmail,
}: CreateSSLCommerzSessionData) => {
  // 1. Find order
  const order = await Order.findById(orderId);

  if (!order) {
    throw new Error("Order not found");
  }

  // 2. Check payment status
  if (order.paymentStatus === "paid") {
    throw new Error("Order is already paid");
  }

  // 3. Check payment method
  if (order.paymentMethod !== "sslcommerz") {
    throw new Error("This order is not configured for SSLCommerz payment");
  }

  // 4. SSLCommerz configuration
  const storeId = process.env.SSLCOMMERZ_STORE_ID;
  const storePassword = process.env.SSLCOMMERZ_STORE_PASSWORD;

  if (!storeId || !storePassword) {
    throw new Error("SSLCommerz credentials are not configured");
  }

  // 5. Create transaction ID
  const transactionId = `SHOPNEST_${order._id.toString()}`;

  // Parse customer details from shippingAddress ("Name | Phone | Address")
  const addressParts = (order.shippingAddress || "")
    .split("|")
    .map((part) => part.trim());
  const cusName = addressParts[0] || "ShopNest Customer";
  const cusPhone = addressParts[1] || "01700000000";
  const cusAddress = (addressParts[2] || order.shippingAddress || "Dhaka").slice(0, 100);

  // 6. Prepare payment data (application/x-www-form-urlencoded format required by SSLCommerz)
  const paymentData = new URLSearchParams({
    store_id: storeId,
    store_passwd: storePassword,

    total_amount: order.totalAmount.toString(),
    currency: "BDT",

    tran_id: transactionId,

    success_url: `${process.env.FRONTEND_URL}/payment/success?orderId=${order._id}`,
    fail_url: `${process.env.FRONTEND_URL}/payment/fail?orderId=${order._id}`,
    cancel_url: `${process.env.FRONTEND_URL}/payment/cancel?orderId=${order._id}`,

    ipn_url: `${process.env.BACKEND_URL}/api/v1/payment/sslcommerz/ipn`,

    shipping_method: "Courier",

    product_name: "ShopNest Order",
    product_category: "Ecommerce",
    product_profile: "general",

    cus_name: cusName,
    cus_email: customerEmail || "customer@example.com",
    cus_add1: cusAddress,
    cus_city: order.division || "Dhaka",
    cus_postcode: "1000",
    cus_country: "Bangladesh",
    cus_phone: cusPhone,

    ship_name: cusName,
    ship_add1: cusAddress,
    ship_city: order.division || "Dhaka",
    ship_postcode: "1000",
    ship_country: "Bangladesh",
  });

  // 7. Create SSLCommerz session
  const response = await sslcommerz.post("", paymentData.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (response.data?.status !== "SUCCESS" || !response.data?.GatewayPageURL) {
    throw new Error(
      response.data?.failedreason || "Failed to create SSLCommerz payment session"
    );
  }

  return response.data;
};

export const sslcommerzService = {
  createPaymentSession,
};