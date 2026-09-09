import mongoose from "mongoose";
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

  // Resolve customer email
  let resolvedCustomerEmail = customerEmail;
  if (!resolvedCustomerEmail && order.userId && mongoose.connection.db) {
    const userDoc = await mongoose.connection.db.collection("user").findOne({
      $or: [
        { id: order.userId },
        {
          _id: (mongoose.Types.ObjectId.isValid(order.userId)
            ? new mongoose.Types.ObjectId(order.userId)
            : null) as any,
        },
      ],
    });
    if (userDoc?.email) {
      resolvedCustomerEmail = userDoc.email;
    }
  }

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

    success_url: `${process.env.FRONTEND_URL}/payment/success?session_id=${transactionId}&orderId=${order._id}`,
    fail_url: `${process.env.FRONTEND_URL}/payment/cancel`,
    cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,

    ipn_url: `${process.env.BACKEND_URL}/api/v1/payment/sslcommerz/ipn`,

    shipping_method: "Courier",

    product_name: "ShopNest Order",
    product_category: "Ecommerce",
    product_profile: "general",

    cus_name: cusName,
    cus_email: resolvedCustomerEmail || "customer@example.com",
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

interface SSLCommerzValidationElement {
  val_id?: string;
  status: string;
  tran_id: string;
  amount: string;
  card_type?: string;
  bank_tran_id?: string;
  [key: string]: unknown;
}

const validatePaymentWithSSLCommerz = async ({
  orderId,
  val_id,
  tran_id,
}: {
  orderId: string;
  val_id?: string;
  tran_id?: string;
}) => {
  const storeId = process.env.SSLCOMMERZ_STORE_ID;
  const storePassword = process.env.SSLCOMMERZ_STORE_PASSWORD;

  if (!storeId || !storePassword) {
    throw new Error("SSLCommerz credentials are not configured");
  }

  const transactionId = tran_id || `SHOPNEST_${orderId}`;

  // 1. If val_id is provided, validate using validationserverAPI
  if (val_id) {
    try {
      const valUrl = `${
        process.env.SSLCOMMERZ_VALIDATION_URL ||
        "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"
      }?val_id=${encodeURIComponent(val_id)}&store_id=${encodeURIComponent(
        storeId
      )}&store_passwd=${encodeURIComponent(storePassword)}&format=json`;

      const valResponse = await sslcommerz.get(valUrl);
      if (
        valResponse.data?.status === "VALID" ||
        valResponse.data?.status === "VALIDATED"
      ) {
        return {
          isValid: true,
          tranId: valResponse.data.tran_id || transactionId,
          amount: parseFloat(valResponse.data.amount) || undefined,
          cardType: valResponse.data.card_type,
          bankTranId: valResponse.data.bank_tran_id,
        };
      }
    } catch (err) {
      console.warn("SSLCommerz validationserverAPI check error:", err);
    }
  }

  // 2. Validate using merchantTransIDvalidationAPI by tran_id
  const isSandbox =
    !process.env.SSLCOMMERZ_VALIDATION_URL ||
    process.env.SSLCOMMERZ_VALIDATION_URL.includes("sandbox");

  const baseUrl = isSandbox
    ? "https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php"
    : "https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php";

  const tranUrl = `${baseUrl}?tran_id=${encodeURIComponent(
    transactionId
  )}&store_id=${encodeURIComponent(storeId)}&store_passwd=${encodeURIComponent(
    storePassword
  )}&format=json`;

  const response = await sslcommerz.get(tranUrl);
  const data = response.data;

  if (data?.element && Array.isArray(data.element)) {
    const validElement = data.element.find(
      (el: SSLCommerzValidationElement) =>
        el.status === "VALID" || el.status === "VALIDATED"
    );

    if (validElement) {
      return {
        isValid: true,
        tranId: validElement.tran_id || transactionId,
        amount: parseFloat(validElement.amount) || undefined,
        cardType: validElement.card_type,
        bankTranId: validElement.bank_tran_id,
      };
    }
  }

  return { isValid: false };
};

export const sslcommerzService = {
  createPaymentSession,
  validatePaymentWithSSLCommerz,
};