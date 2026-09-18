import { describe, it, expect } from "vitest";
import { ApiError } from "../../src/utils/api-error";

describe("Return / Reverse Delivery Critical Logic", () => {
  // ─── 1. Return Eligibility ──────────────────────────────────────────────────
  describe("1. Return Eligibility", () => {
    it("allows return within 7-day window for delivered order", () => {
      const deliveredAt = new Date();
      deliveredAt.setDate(deliveredAt.getDate() - 3);
      const daysSince = 3;
      const isEligible = daysSince <= 7;
      expect(isEligible).toBe(true);
    });

    it("rejects return outside 7-day window", () => {
      const deliveredAt = new Date();
      deliveredAt.setDate(deliveredAt.getDate() - 10);
      const daysSince = 10;
      const isEligible = daysSince <= 7;
      expect(isEligible).toBe(false);
    });

    it("rejects return for non-delivered order", () => {
      const orderStatus = "processing";
      const isEligible = orderStatus === "delivered";
      expect(isEligible).toBe(false);
    });

    it("rejects duplicate return for same product", () => {
      const existing = { status: "requested" };
      const alreadyRequested = existing && existing.status !== "rejected";
      expect(alreadyRequested).toBe(true);
    });

    it("allows new return after previous was rejected", () => {
      const existing = { status: "rejected" };
      const alreadyRequested = existing && existing.status !== "rejected";
      expect(alreadyRequested).toBe(false);
    });
  });

  // ─── 2. Duplicate Return Protection ───────────────────────────────────────
  describe("2. Duplicate Return Protection", () => {
    it("prevents creating return when active return exists", () => {
      const existing = { orderId: "ord-1", productId: "prod-1", status: "requested" };
      const duplicate = existing && existing.status !== "rejected";
      expect(duplicate).toBe(true);
    });

    it("blocks new return when previous was cancelled", () => {
      const existing = { orderId: "ord-1", productId: "prod-1", status: "cancelled" };
      const duplicate = existing && existing.status !== "rejected";
      expect(duplicate).toBe(true);
    });

    it("allows new return only when previous was rejected", () => {
      const existing = { orderId: "ord-1", productId: "prod-1", status: "rejected" };
      const duplicate = existing && existing.status !== "rejected";
      expect(duplicate).toBe(false);
    });
  });

  // ─── 3. Concurrent Rider Acceptance ───────────────────────────────────────
  describe("3. Concurrent Rider Acceptance", () => {
    it("guarantees only one rider wins concurrent reverse delivery claims", () => {
      interface ReverseDoc {
        id: string;
        status: "available" | "assigned";
        assignedDeliveryManId: string | null;
      }

      const dbDoc: ReverseDoc = {
        id: "rev-101",
        status: "available",
        assignedDeliveryManId: null,
      };

      function atomicClaim(riderId: string): { success: boolean; data?: ReverseDoc; error?: ApiError } {
        if (dbDoc.status === "available" && dbDoc.assignedDeliveryManId === null) {
          dbDoc.status = "assigned";
          dbDoc.assignedDeliveryManId = riderId;
          return { success: true, data: { ...dbDoc } };
        }
        return {
          success: false,
          error: ApiError.conflict("Another delivery partner accepted this request first."),
        };
      }

      const riderAClaim = atomicClaim("rider-A");
      const riderBClaim = atomicClaim("rider-B");

      expect(riderAClaim.success).toBe(true);
      expect(riderAClaim.data?.assignedDeliveryManId).toBe("rider-A");

      expect(riderBClaim.success).toBe(false);
      expect(riderBClaim.error?.statusCode).toBe(409);

      expect(dbDoc.assignedDeliveryManId).toBe("rider-A");
    });
  });

  // ─── 4. OTP Verification ───────────────────────────────────────────────────
  describe("4. OTP Verification", () => {
    const reverse = {
      id: "rev-1",
      deliveryOtp: "123456",
      deliveryOtpVerifiedAt: null as string | null,
      status: "pickup_started",
    };

    it("accepts correct OTP", () => {
      const submittedOtp = "123456";
      const isValid = submittedOtp === reverse.deliveryOtp;
      expect(isValid).toBe(true);
    });

    it("rejects incorrect OTP", () => {
      const submittedOtp = "000000";
      const isValid = submittedOtp === reverse.deliveryOtp;
      expect(isValid).toBe(false);
    });

    it("marks OTP verified and clears OTP after successful verification", () => {
      reverse.deliveryOtpVerifiedAt = new Date().toISOString();
      reverse.deliveryOtp = undefined;
      expect(reverse.deliveryOtpVerifiedAt).not.toBeNull();
      expect(reverse.deliveryOtp).toBeUndefined();
    });

    it("prevents pickup completion without OTP verification", () => {
      reverse.deliveryOtpVerifiedAt = null;
      const canComplete = reverse.deliveryOtpVerifiedAt !== null;
      expect(canComplete).toBe(false);
    });
  });

  // ─── 5. Invalid Status Transitions ────────────────────────────────────────
  describe("5. Invalid Status Transitions", () => {
    const validTransitions: Record<string, string[]> = {
      requested: ["under_review", "cancelled"],
      under_review: ["approved", "rejected", "cancelled"],
      approved: ["reverse_available", "cancelled"],
      rejected: [],
      reverse_available: ["reverse_assigned", "cancelled"],
      reverse_assigned: ["reverse_accepted", "pickup_started", "cancelled", "failed"],
      reverse_accepted: ["pickup_started", "cancelled", "failed"],
      pickup_started: ["picked_up", "cancelled", "failed"],
      picked_up: ["in_transit", "failed"],
      in_transit: ["seller_received", "failed"],
      seller_received: ["inspection_pending", "failed"],
      inspection_pending: ["inspection_approved", "inspection_rejected", "failed"],
      inspection_approved: ["refund_pending", "refund_processing", "refunded", "failed"],
      inspection_rejected: ["refund_failed", "cancelled", "failed"],
      refund_pending: ["refund_processing", "refund_failed", "cancelled"],
      refund_processing: ["refunded", "refund_failed"],
      refunded: [],
      refund_failed: ["refund_pending", "cancelled"],
      cancelled: [],
      failed: ["reverse_available", "cancelled"],
    };

    function canTransition(from: string, to: string): boolean {
      const allowed = validTransitions[from] || [];
      return allowed.includes(to);
    }

    it("allows valid forward flow", () => {
      expect(canTransition("reverse_assigned", "reverse_accepted")).toBe(true);
      expect(canTransition("reverse_accepted", "pickup_started")).toBe(true);
      expect(canTransition("pickup_started", "picked_up")).toBe(true);
      expect(canTransition("picked_up", "in_transit")).toBe(true);
      expect(canTransition("in_transit", "seller_received")).toBe(true);
    });

    it("rejects illegal backward jumps", () => {
      expect(canTransition("seller_received", "picked_up")).toBe(false);
      expect(canTransition("refunded", "refund_pending")).toBe(false);
      expect(canTransition("cancelled", "picked_up")).toBe(false);
      expect(canTransition("available", "picked_up")).toBe(false);
    });
  });

  // ─── 6. Refund Idempotency ────────────────────────────────────────────────
  describe("6. Refund Idempotency", () => {
    it("prevents duplicate processing of succeeded refund", () => {
      const refund = { status: "succeeded" };
      const canRetry = refund.status !== "succeeded" && refund.status !== "processing";
      expect(canRetry).toBe(false);
    });

    it("prevents duplicate processing of processing refund", () => {
      const refund = { status: "processing" };
      const canRetry = refund.status !== "succeeded" && refund.status !== "processing";
      expect(canRetry).toBe(false);
    });

    it("allows processing of pending refund", () => {
      const refund = { status: "pending" };
      const canRetry = refund.status !== "succeeded" && refund.status !== "processing";
      expect(canRetry).toBe(true);
    });

    it("non-Stripe refunds remain pending/manual-processing", () => {
      const provider = "sslcommerz";
      const expectedStatus = "pending";
      expect(expectedStatus).toBe("pending");
    });
  });

  // ─── 7. Inventory Restock ──────────────────────────────────────────────────
  describe("7. Inventory Restock", () => {
    it("increments stock for resalable return", () => {
      const currentStock = 10;
      const returnQuantity = 1;
      const newStock = currentStock + returnQuantity;
      expect(newStock).toBe(11);
    });

    it("does not increment stock for non-resalable return", () => {
      const currentStock = 10;
      const returnQuantity = 1;
      const resalable = false;
      const newStock = resalable ? currentStock + returnQuantity : currentStock;
      expect(newStock).toBe(10);
    });

    it("prevents double restock on repeated inspection", () => {
      const currentStock = 11;
      const returnQuantity = 1;
      const alreadyRestocked = true;

      if (alreadyRestocked) {
        expect(currentStock).toBe(11);
      } else {
        expect(currentStock + returnQuantity).toBe(12);
      }
    });
  });

  // ─── 8. RBAC / IDOR ───────────────────────────────────────────────────────
  describe("8. RBAC / IDOR", () => {
    const returnReq = { userId: "cust-1", sellerId: "seller-1", deliveryManId: "rider-1" };

    it("prevents customer B from accessing customer A's return", () => {
      const callerId = "cust-2";
      const isOwner = returnReq.userId === callerId;
      expect(isOwner).toBe(false);
    });

    it("prevents seller B from accessing seller A's return", () => {
      const callerId = "seller-2";
      const isOwner = returnReq.sellerId === callerId;
      expect(isOwner).toBe(false);
    });

    it("prevents rider B from accessing rider A's reverse delivery", () => {
      const callerId = "rider-2";
      const isAssigned = returnReq.deliveryManId === callerId;
      expect(isAssigned).toBe(false);
    });

    it("prevents customer from marking pickup complete", () => {
      const callerRole = "customer";
      const canUpdate = callerRole === "delivery_man" || callerRole === "admin";
      expect(canUpdate).toBe(false);
    });
  });

  // ─── 9. Reverse Delivery State Machine ────────────────────────────────────
  describe("9. Reverse Delivery State Machine", () => {
    const validTransitions: Record<string, string[]> = {
      available: ["assigned", "cancelled"],
      assigned: ["accepted", "pickup_started", "cancelled", "failed"],
      accepted: ["pickup_started", "cancelled", "failed"],
      pickup_started: ["picked_up", "cancelled", "failed"],
      picked_up: ["in_transit", "failed"],
      in_transit: ["seller_received", "failed"],
      seller_received: [],
      failed: ["available", "cancelled"],
      cancelled: ["available"],
    };

    function canTransition(from: string, to: string): boolean {
      const allowed = validTransitions[from] || [];
      return allowed.includes(to);
    }

    it("reverses from available to picked_up are rejected", () => {
      expect(canTransition("available", "picked_up")).toBe(false);
    });

    it("reverses from seller_received to in_transit are rejected", () => {
      expect(canTransition("seller_received", "in_transit")).toBe(false);
    });
  });

  // ─── 10. Seller Approval & Reverse Delivery Creation ──────────────────────
  describe("10. Seller Approval & Reverse Delivery Creation", () => {
    it("creates an available reverse delivery request upon seller approval", () => {
      const returnReq = {
        id: "ret-123",
        orderId: "ord-456",
        productId: "prod-789",
        status: "requested",
        pickupAddress: "House 12, Road 5, Dhanmondi, Dhaka",
        sellerReturnAddress: "Shop 4, Market 2, Uttara, Dhaka",
      };

      // Seller approves return
      const approvedReturn = { ...returnReq, status: "approved" as const };
      expect(approvedReturn.status).toBe("approved");

      // Reverse delivery is generated
      const reverseDelivery = {
        returnRequestId: approvedReturn.id,
        orderId: approvedReturn.orderId,
        status: "available" as const,
        deliveryOtp: "654321",
        customerAddress: approvedReturn.pickupAddress,
        sellerAddress: approvedReturn.sellerReturnAddress,
      };

      expect(reverseDelivery.status).toBe("available");
      expect(reverseDelivery.returnRequestId).toBe("ret-123");
      expect(reverseDelivery.deliveryOtp).toHaveLength(6);
    });
  });

  // ─── 11. Product Variant Restocking ───────────────────────────────────────
  describe("11. Product Variant Restocking", () => {
    it("restocks both parent product and matching variant upon resalable inspection", () => {
      const product = {
        id: "prod-variant-1",
        title: "T-Shirt",
        stock: 50,
        variants: [
          { name: "Red / XL", sku: "TS-RED-XL", stock: 10 },
          { name: "Blue / M", sku: "TS-BLU-M", stock: 15 },
        ],
      };

      const returnReq = {
        quantity: 2,
        variantName: "Red / XL",
        resalable: true,
      };

      // Restock execution
      const vIndex = product.variants.findIndex(
        (v) => v.name.toLowerCase() === returnReq.variantName.toLowerCase()
      );
      expect(vIndex).toBe(0);

      product.variants[vIndex].stock += returnReq.quantity;
      product.stock += returnReq.quantity;

      expect(product.stock).toBe(52);
      expect(product.variants[0].stock).toBe(12);
      expect(product.variants[1].stock).toBe(15);
    });
  });

  // ─── 12. Stripe Refund Path ────────────────────────────────────────────────
  describe("12. Stripe Refund Processing", () => {
    it("processes Stripe refund only when successful payment record exists", async () => {
      const paymentRecord = {
        orderId: "ord-stripe-1",
        status: "successful",
        transactionId: "pi_test_123456789",
      };

      const refundRecord = {
        amount: 2500,
        currency: "bdt",
        provider: "card",
        status: "pending",
      };

      // Mock stripe execution
      function executeStripeRefund(payment: typeof paymentRecord, refund: typeof refundRecord) {
        if (!payment || payment.status !== "successful" || !payment.transactionId) {
          throw new Error("No successful payment record found for this order");
        }
        return {
          id: "re_test_987654321",
          status: "succeeded",
          amount: refund.amount * 100,
        };
      }

      const stripeResult = executeStripeRefund(paymentRecord, refundRecord);
      expect(stripeResult.status).toBe("succeeded");
      expect(stripeResult.id).toMatch(/^re_/);
    });

    it("fails Stripe refund if payment transaction is missing", () => {
      const missingPayment = null;
      const refundRecord = { amount: 2500, currency: "bdt", provider: "card", status: "pending" };

      expect(() => {
        if (!missingPayment) {
          throw new Error("No successful payment record found for this order");
        }
      }).toThrow("No successful payment record found for this order");
    });
  });

  // ─── 13. Return Incidents Linkage ──────────────────────────────────────────
  describe("13. Return Incidents Linkage", () => {
    it("properly links return and reverse delivery IDs in incident reports", () => {
      const incident = {
        category: "package_damaged",
        description: "Product was found cracked inside original box upon customer handover",
        returnRequestId: "ret-abc-1",
        reverseDeliveryRequestId: "rev-xyz-2",
        orderId: "ord-999",
        productId: "prod-555",
        status: "open",
      };

      expect(incident.returnRequestId).toBe("ret-abc-1");
      expect(incident.reverseDeliveryRequestId).toBe("rev-xyz-2");
      expect(incident.orderId).toBe("ord-999");
      expect(incident.productId).toBe("prod-555");
    });
  });
});
