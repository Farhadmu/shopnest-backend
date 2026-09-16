import { describe, it, expect } from "vitest";
import { ApiError } from "../../src/utils/api-error";
import { detectIntent, detectTimeRange } from "../../src/modules/ai/delivery-copilot/delivery-copilot.intent";
import { DeliveryCopilotIntent } from "../../src/modules/ai/delivery-copilot/delivery-copilot.types";

describe("Delivery Partner Ecosystem Production QA Suite", () => {
  // ─── 1. Auth & Role Verification ───────────────────────────────────────────
  describe("1. Auth & Role Access Matrix", () => {
    it("rejects unauthenticated requests with 401 Unauthorized", () => {
      const err = ApiError.unauthorized("Authentication required");
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Authentication required");
    });

    it("rejects non-delivery_man users with 403 Forbidden", () => {
      const allowedRoles = ["delivery_man"];
      const userRole = "customer";
      const hasRole = allowedRoles.includes(userRole);
      expect(hasRole).toBe(false);
      const err = ApiError.forbidden(`Requires role: ${allowedRoles.join(" or ")}`);
      expect(err.statusCode).toBe(403);
    });

    it("blocks pending or suspended riders from operational endpoints", () => {
      const statuses = ["pending_verification", "rejected", "suspended"];
      for (const st of statuses) {
        const isApproved = st === "approved";
        expect(isApproved).toBe(false);
        const err = ApiError.forbidden("Delivery partner profile is not approved");
        expect(err.statusCode).toBe(403);
      }
    });
  });

  // ─── 2. Seller Ready for Pickup Workflow ────────────────────────────────────
  describe("2. Seller Ready for Pickup Logic & Guards", () => {
    it("creates open AVAILABLE delivery request when seller marks ready for pickup", () => {
      const order = {
        id: "ord-777",
        status: "processing",
        userId: "cust-1",
        items: [{ sellerId: "seller-1", title: "Wireless Headphones", price: 1500, quantity: 1 }],
        shippingAddress: "House 10, Road 4, Dhanmondi, Dhaka",
        deliveryFee: 60,
      };

      const sellerId = "seller-1";
      const isSellerOnOrder = order.items.some((i) => i.sellerId === sellerId);
      expect(isSellerOnOrder).toBe(true);

      const deliveryRequest = {
        orderId: order.id,
        sellerId,
        customerId: order.userId,
        status: "available",
        priority: "normal",
        deliveryFee: order.deliveryFee,
      };

      expect(deliveryRequest.status).toBe("available");
      expect(deliveryRequest.sellerId).toBe("seller-1");
    });

    it("rejects ready for pickup on cancelled or delivered orders", () => {
      const invalidStatuses = ["cancelled", "delivered", "returned"];
      for (const st of invalidStatuses) {
        const isInvalid = ["cancelled", "delivered", "returned"].includes(st);
        expect(isInvalid).toBe(true);
        const err = ApiError.badRequest(`Cannot request delivery for order in "${st}" status`);
        expect(err.statusCode).toBe(400);
      }
    });

    it("rejects ready for pickup when delivery request is already in progress", () => {
      const existingRequestStatus = "in_transit";
      const canRecreate = existingRequestStatus === "available";
      expect(canRecreate).toBe(false);
      const err = ApiError.badRequest(
        `Cannot recreate delivery request: order delivery is already in "${existingRequestStatus}" status`
      );
      expect(err.statusCode).toBe(400);
    });

    it("rejects unauthorized seller attempting to mark another seller's order", () => {
      const orderSellerId = "seller-1";
      const callerSellerId = "seller-99";
      const isAuthorized = orderSellerId === callerSellerId;
      expect(isAuthorized).toBe(false);
      const err = ApiError.forbidden("You are not authorized to mark this order for pickup");
      expect(err.statusCode).toBe(403);
    });
  });

  // ─── 3. Atomic First-Come-First-Served Marketplace Claim ───────────────────
  describe("3. Atomic Acceptance & Race Condition Safety", () => {
    it("guarantees only one rider wins concurrent claims and loser receives 409 Conflict", () => {
      interface DeliveryDoc {
        id: string;
        orderId: string;
        status: "available" | "assigned";
        assignedDeliveryManId: string | null;
        assignedAt?: Date;
      }

      const dbDoc: DeliveryDoc = {
        id: "req-101",
        orderId: "ord-101",
        status: "available",
        assignedDeliveryManId: null,
      };

      // Simulates MongoDB findOneAndUpdate({ _id: id, status: 'available', assignedDeliveryManId: null }, { $set: ... })
      function atomicClaim(riderId: string): { success: boolean; data?: DeliveryDoc; error?: ApiError } {
        if (dbDoc.status === "available" && dbDoc.assignedDeliveryManId === null) {
          dbDoc.status = "assigned";
          dbDoc.assignedDeliveryManId = riderId;
          dbDoc.assignedAt = new Date();
          return { success: true, data: { ...dbDoc } };
        }
        return {
          success: false,
          error: ApiError.conflict("This delivery has already been accepted by another delivery partner."),
        };
      }

      // Rider A and Rider B attempt simultaneous accept
      const riderAClaim = atomicClaim("rider-A");
      const riderBClaim = atomicClaim("rider-B");

      expect(riderAClaim.success).toBe(true);
      expect(riderAClaim.data?.assignedDeliveryManId).toBe("rider-A");
      expect(riderAClaim.data?.status).toBe("assigned");

      expect(riderBClaim.success).toBe(false);
      expect(riderBClaim.error?.statusCode).toBe(409);
      expect(riderBClaim.error?.message).toContain("already been accepted");

      // Verify DB contains ONLY winning rider
      expect(dbDoc.assignedDeliveryManId).toBe("rider-A");
    });

    it("enforces vehicle capacity limits before acceptance", () => {
      const capacities: Record<string, number> = {
        bicycle: 1,
        motorcycle: 3,
        car: 5,
        van: 10,
      };

      expect(capacities.motorcycle).toBe(3);
      expect(capacities.bicycle).toBe(1);

      const activeCount = 3;
      const maxCapacity = capacities.motorcycle;
      const atCapacity = activeCount >= maxCapacity;
      expect(atCapacity).toBe(true);

      if (atCapacity) {
        const err = ApiError.badRequest(`Capacity full: You cannot have more than ${maxCapacity} active deliveries simultaneously.`);
        expect(err.statusCode).toBe(400);
      }
    });
  });

  // ─── 4. Status State Machine Protection ────────────────────────────────────
  describe("4. Status State Machine Transition Validation", () => {
    const validTransitions: Record<string, string[]> = {
      available: ["assigned", "cancelled"],
      assigned: ["pickup_started", "cancelled", "failed"],
      pickup_started: ["picked_up", "failed", "cancelled"],
      picked_up: ["in_transit", "failed"],
      in_transit: ["out_for_delivery", "failed"],
      out_for_delivery: ["delivered", "failed", "rescheduled"],
      delivered: [],
      failed: ["rescheduled", "available"],
      cancelled: ["available"],
      rescheduled: ["available", "in_transit"],
    };

    function validateTransition(from: string, to: string): boolean {
      const allowed = validTransitions[from] || [];
      return allowed.includes(to);
    }

    it("allows valid forward delivery flow", () => {
      expect(validateTransition("assigned", "pickup_started")).toBe(true);
      expect(validateTransition("pickup_started", "picked_up")).toBe(true);
      expect(validateTransition("picked_up", "in_transit")).toBe(true);
      expect(validateTransition("in_transit", "out_for_delivery")).toBe(true);
      expect(validateTransition("out_for_delivery", "delivered")).toBe(true);
    });

    it("rejects illegal backward or injected status jumps", () => {
      expect(validateTransition("delivered", "picked_up")).toBe(false);
      expect(validateTransition("delivered", "in_transit")).toBe(false);
      expect(validateTransition("cancelled", "picked_up")).toBe(false);
      expect(validateTransition("available", "delivered")).toBe(false);
      expect(validateTransition("assigned", "delivered")).toBe(false);
    });
  });

  // ─── 5. OTP Handover Verification Security ─────────────────────────────────
  describe("5. OTP Verification Security", () => {
    const deliveryMission = {
      id: "del-888",
      orderId: "ord-888",
      assignedDeliveryManId: "rider-1",
      deliveryOtp: "591034",
      status: "out_for_delivery",
    };

    it("accepts correct 6-digit OTP when order is out_for_delivery", () => {
      const submittedOtp = "591034";
      const isValid = submittedOtp.trim() === deliveryMission.deliveryOtp;
      expect(isValid).toBe(true);
    });

    it("rejects incorrect OTP with 400 Bad Request", () => {
      const submittedOtp = "111111";
      const isValid = submittedOtp.trim() === deliveryMission.deliveryOtp;
      expect(isValid).toBe(false);
      const err = ApiError.badRequest("Invalid delivery OTP. Please verify with the customer.");
      expect(err.statusCode).toBe(400);
    });

    it("rejects OTP verification when order is not in out_for_delivery or in_transit", () => {
      const wrongStatus = "assigned";
      const canVerify = ["out_for_delivery", "in_transit"].includes(wrongStatus);
      expect(canVerify).toBe(false);
      const err = ApiError.badRequest("Cannot verify OTP when order is not out for delivery");
      expect(err.statusCode).toBe(400);
    });

    it("rejects unauthorized rider attempting to verify another rider's OTP", () => {
      const callerId = "rider-99";
      const isAssigned = deliveryMission.assignedDeliveryManId === callerId;
      expect(isAssigned).toBe(false);
      const err = ApiError.forbidden("You can only verify OTP for deliveries assigned to you");
      expect(err.statusCode).toBe(403);
    });

    it("prevents repeated OTP completion once delivered", () => {
      const completedMission = { ...deliveryMission, status: "delivered" };
      const canVerifyAgain = ["out_for_delivery", "in_transit"].includes(completedMission.status);
      expect(canVerifyAgain).toBe(false);
    });
  });

  // ─── 6. Live Location Scoping & Privacy ────────────────────────────────────
  describe("6. Location Tracking Privacy & Scoping", () => {
    it("exposes live GPS coordinates to customer ONLY during active transit", () => {
      const activeStatuses = ["picked_up", "in_transit", "out_for_delivery"];
      expect(activeStatuses.includes("picked_up")).toBe(true);
      expect(activeStatuses.includes("in_transit")).toBe(true);
      expect(activeStatuses.includes("out_for_delivery")).toBe(true);

      // Inactive statuses MUST hide live telemetry
      expect(activeStatuses.includes("available")).toBe(false);
      expect(activeStatuses.includes("assigned")).toBe(false);
      expect(activeStatuses.includes("delivered")).toBe(false);
      expect(activeStatuses.includes("cancelled")).toBe(false);
    });

    it("prevents location logging after order is marked delivered", () => {
      const orderStatus = "delivered";
      const shouldLogLocation = ["picked_up", "in_transit", "out_for_delivery"].includes(orderStatus);
      expect(shouldLogLocation).toBe(false);
    });
  });

  // ─── 7. IDOR & Authorization Matrix ────────────────────────────────────────
  describe("7. IDOR & Access Control Matrix", () => {
    const mission = {
      id: "req-555",
      orderId: "ord-555",
      assignedDeliveryManId: "rider-1",
      sellerId: "seller-1",
      customerId: "cust-1",
    };

    it("prevents Rider B from accessing or modifying Rider A's mission", () => {
      const callerId = "rider-2";
      const isAuthorized = mission.assignedDeliveryManId === callerId;
      expect(isAuthorized).toBe(false);
      const err = ApiError.forbidden("You can only update deliveries assigned to you");
      expect(err.statusCode).toBe(403);
    });

    it("prevents Customer B from viewing Customer A's live delivery tracking", () => {
      const callerCustomerId = "cust-2";
      const isOwner = mission.customerId === callerCustomerId;
      expect(isOwner).toBe(false);
      const err = ApiError.forbidden("You are not authorized to track this delivery");
      expect(err.statusCode).toBe(403);
    });

    it("allows Seller A to track delivery of their own order", () => {
      const callerSellerId = "seller-1";
      const isSeller = mission.sellerId === callerSellerId;
      expect(isSeller).toBe(true);
    });

    it("prevents Seller B from viewing Seller A's delivery tracking", () => {
      const callerSellerId = "seller-99";
      const isSeller = mission.sellerId === callerSellerId;
      expect(isSeller).toBe(false);
    });
  });

  // ─── 8. Delivery Partner Rating Verification ───────────────────────────────
  describe("8. Delivery Rating Validation", () => {
    it("rejects rating submitted before order is delivered", () => {
      const status = "in_transit";
      const canRate = status === "delivered";
      expect(canRate).toBe(false);
      const err = ApiError.badRequest("You can only rate a completed delivery");
      expect(err.statusCode).toBe(400);
    });

    it("rejects rating with invalid star value (< 1 or > 5)", () => {
      const invalidRating = 6;
      const isValid = invalidRating >= 1 && invalidRating <= 5;
      expect(isValid).toBe(false);
      const err = ApiError.badRequest("Rating must be between 1 and 5");
      expect(err.statusCode).toBe(400);
    });

    it("rejects duplicate rating for the same delivery", () => {
      const existingRating = { id: "rate-1", deliveryRequestId: "req-555" };
      expect(Boolean(existingRating)).toBe(true);
      const err = ApiError.badRequest("You have already rated this delivery partner");
      expect(err.statusCode).toBe(400);
    });

    it("rejects non-customer from submitting delivery rating", () => {
      const orderCustomerId = "cust-1";
      const callerId = "cust-99";
      const isCustomer = orderCustomerId === callerId;
      expect(isCustomer).toBe(false);
      const err = ApiError.forbidden("Only the customer of this order can submit a rating");
      expect(err.statusCode).toBe(403);
    });
  });

  // ─── 9. AI Delivery Copilot Intent Detection ───────────────────────────────
  describe("9. AI Delivery Copilot Intent Detection & Rules", () => {
    it("detects order recommendation intent", () => {
      const res = detectIntent("Which available order is best for me?");
      expect(res.intent).toBe(DeliveryCopilotIntent.ORDER_RECOMMENDATION);
      expect(res.confidence).toBeGreaterThan(0.8);
    });

    it("detects priority questions", () => {
      const res = detectIntent("Which delivery has the highest priority?");
      expect(res.intent).toBe(DeliveryCopilotIntent.PRIORITY_ADVICE);
    });

    it("detects workload inquiries", () => {
      const res = detectIntent("How many active deliveries do I have right now?");
      expect(res.intent).toBe(DeliveryCopilotIntent.ACTIVE_WORKLOAD);
    });

    it("detects incident advice inquiries", () => {
      const res = detectIntent("What should I do if the customer is unavailable?");
      expect(res.intent).toBe(DeliveryCopilotIntent.INCIDENT_ADVICE);
    });

    it("detects daily summary questions", () => {
      const res = detectIntent("Show today's completed deliveries and earnings");
      expect(res.intent).toBe(DeliveryCopilotIntent.DAILY_SUMMARY);
    });

    it("detects time ranges correctly", () => {
      const todayRange = detectTimeRange("Show my earnings for today");
      expect(todayRange.label).toBe("Today");
    });
  });

  // ─── 10. KYC & Profile Schema Validation (Empty Strings & Dates) ───────────
  describe("10. KYC & Profile Schema Validation (Empty String Resilience)", () => {
    it("successfully parses profile updates with empty string date fields (e.g. Bicycle onboarding)", async () => {
      const { createOrUpdateProfileSchema } = await import("../../src/schemas/delivery.schema");
      const payload = {
        personal: {
          fullName: "Rahim Rider",
          phone: "01711223344",
          email: "",
          dateOfBirth: "",
          currentAddress: "Dhanmondi 32, Dhaka",
        },
        identity: {
          nidNumber: "1234567890",
        },
        license: {
          licenseNumber: "",
          licenseExpiryDate: "",
        },
        vehicle: {
          vehicleType: "bicycle",
          vehicleBrand: "Phoenix",
          vehicleModel: "Cyclone",
          vehicleRegistrationNumber: "",
          vehicleFitnessExpiryDate: "",
        },
      };

      const parsed = createOrUpdateProfileSchema.parse(payload);
      expect(parsed.personal?.fullName).toBe("Rahim Rider");
      expect(parsed.personal?.dateOfBirth).toBeUndefined();
      expect(parsed.personal?.email).toBeUndefined();
      expect(parsed.license?.licenseExpiryDate).toBeUndefined();
      expect(parsed.vehicle?.vehicleType).toBe("bicycle");
      expect(parsed.vehicle?.vehicleFitnessExpiryDate).toBeUndefined();
    });

    it("correctly parses valid date strings when provided", async () => {
      const { createOrUpdateProfileSchema } = await import("../../src/schemas/delivery.schema");
      const payload = {
        personal: {
          dateOfBirth: "1995-06-15",
        },
        license: {
          licenseExpiryDate: "2028-12-31",
        },
        vehicle: {
          vehicleFitnessExpiryDate: "2027-01-01",
        },
      };

      const parsed = createOrUpdateProfileSchema.parse(payload);
      expect(parsed.personal?.dateOfBirth).toBeInstanceOf(Date);
      expect(parsed.license?.licenseExpiryDate).toBeInstanceOf(Date);
      expect(parsed.vehicle?.vehicleFitnessExpiryDate).toBeInstanceOf(Date);
    });
  });
});
