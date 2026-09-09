import mongoose from "mongoose";
import { Request, Response } from "express";
import { sslcommerzService } from "./sslcommerz.service";
import { Order } from "../../modules/orders/order.model";
import { handleSSLCommerzPaymentSuccess } from "./sslcommerz.helper";

const resolveCustomerEmail = async (userId?: string): Promise<string> => {
  if (!userId || !mongoose.connection.db) return "";
  try {
    const userDoc = await mongoose.connection.db.collection("user").findOne({
      $or: [
        { id: userId },
        {
          _id: (mongoose.Types.ObjectId.isValid(userId)
            ? new mongoose.Types.ObjectId(userId)
            : null) as any,
        },
      ],
    });
    return userDoc?.email || "";
  } catch {
    return "";
  }
};

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

const verifyPayment = async (req: Request, res: Response) => {
  try {
    const orderId = (req.query.orderId || req.body.orderId) as string;
    const val_id = (req.query.val_id || req.body.val_id) as string | undefined;
    const tran_id = (req.query.tran_id || req.query.sessionId || req.body.tran_id) as
      | string
      | undefined;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const customerEmail = await resolveCustomerEmail(order.userId);

    // If order is already paid, return early
    if (order.paymentStatus === "paid") {
      return res.status(200).json({
        success: true,
        message: "Payment already verified",
        data: {
          orderId: order._id.toString(),
          paymentStatus: order.paymentStatus,
          orderStatus: order.status,
          customerEmail,
          order: { ...order.toJSON(), customerEmail },
        },
      });
    }

    // Validate with SSLCommerz
    const validation = await sslcommerzService.validatePaymentWithSSLCommerz({
      orderId,
      val_id,
      tran_id,
    });

    if (validation.isValid) {
      const { order: updatedOrder } = await handleSSLCommerzPaymentSuccess({
        orderId,
        transactionId: validation.tranId,
        amount: validation.amount,
        cardType: validation.cardType,
        bankTranId: validation.bankTranId,
      });

      return res.status(200).json({
        success: true,
        message: "SSLCommerz payment verified successfully",
        data: {
          orderId: updatedOrder._id.toString(),
          paymentStatus: updatedOrder.paymentStatus,
          orderStatus: updatedOrder.status,
          customerEmail,
          order: { ...updatedOrder.toJSON(), customerEmail },
        },
      });
    }

    return res.status(400).json({
      success: false,
      message:
        "Payment could not be verified with SSLCommerz. Status is not valid.",
      data: {
        orderId: order._id.toString(),
        paymentStatus: order.paymentStatus,
        orderStatus: order.status,
        order: order.toJSON(),
      },
    });
  } catch (error) {
    console.error("SSLCommerz verify payment error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to verify SSLCommerz payment",
    });
  }
};

const handleIPN = async (req: Request, res: Response) => {
  try {
    const { tran_id, val_id, status, amount, card_type, bank_tran_id } = req.body;

    if (!tran_id) {
      return res.status(400).send("Transaction ID is missing");
    }

    const orderId = tran_id.startsWith("SHOPNEST_")
      ? tran_id.replace("SHOPNEST_", "")
      : tran_id;

    if (status === "VALID" || status === "VALIDATED") {
      await handleSSLCommerzPaymentSuccess({
        orderId,
        transactionId: tran_id,
        amount: parseFloat(amount) || undefined,
        cardType: card_type,
        bankTranId: bank_tran_id,
      });
    }

    return res.status(200).send("IPN Processed");
  } catch (error) {
    console.error("SSLCommerz IPN error:", error);
    return res.status(500).send("IPN processing error");
  }
};

export const sslcommerzController = {
  createPaymentSession,
  verifyPayment,
  handleIPN,
};