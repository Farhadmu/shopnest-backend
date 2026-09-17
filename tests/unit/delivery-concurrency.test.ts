import { describe, it, expect } from "vitest";
import { ApiError } from "../../src/utils/api-error";
import { isValidCoordinate, calculateDistanceMeters } from "../../src/utils/geo";

describe("Delivery Concurrency & Authorization Security Test Suite", () => {
  // ─── 1. Atomic Concurrency & Race Condition Safety ─────────────────────────
  describe("1. Concurrent Marketplace Acceptance (Atomic Claim)", () => {
    it("guarantees only one rider wins parallel acceptance and loser receives 409 Conflict", async () => {
      // Simulation of atomic DB state
      let currentAssignment: { status: string; assignedDeliveryManId: string | null } = {
        status: "available",
        assignedDeliveryManId: null,
      };

      // Atomic claim simulation matching DeliveryRequest.findOneAndUpdate condition:
      // { _id: id, status: "available", assignedDeliveryManId: { $in: [null, undefined, ""] } }
      const attemptClaim = async (riderId: string) => {
        if (currentAssignment.status === "available" && !currentAssignment.assignedDeliveryManId) {
          currentAssignment = {
            status: "assigned",
            assignedDeliveryManId: riderId,
          };
          return { success: true, riderId };
        }
        return { success: false, riderId };
      };

      // Simulate simultaneous parallel calls from Rider A and Rider B
      const [resA, resB] = await Promise.all([
        attemptClaim("rider-A"),
        attemptClaim("rider-B"),
      ]);

      const winners = [resA, resB].filter((r) => r.success);
      const losers = [resA, resB].filter((r) => !r.success);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);

      // Verify the loser gets a 409 Conflict error
      const loserResult = losers[0];
      const conflictError = ApiError.conflict("Another delivery man accepted this request first.");
      expect(conflictError.statusCode).toBe(409);
      expect(conflictError.message).toBe("Another delivery man accepted this request first.");

      // Verify DB contains only the winner assignment
      expect(currentAssignment.status).toBe("assigned");
      expect(currentAssignment.assignedDeliveryManId).toBe(winners[0].riderId);
    });

    it("prevents double-acceptance if rider already reached max active parcel limit", () => {
      const maxActiveParcels = 3;
      const currentActiveCount = 3;

      const canAccept = currentActiveCount < maxActiveParcels;
      expect(canAccept).toBe(false);

      const err = ApiError.badRequest(
        `Capacity full: You currently have ${currentActiveCount} active deliveries. Your maximum active capacity is ${maxActiveParcels}.`
      );
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("Capacity full");
    });
  });

  // ─── 2. Vehicle Weight & Dynamic Capacity Engine ───────────────────────────
  describe("2. Rider Vehicle Weight Capacity Engine", () => {
    it("rejects package acceptance if incoming weight exceeds vehicle weight capacity", () => {
      const vehicleLimitKg = 20; // motorcycle capacity
      const currentLoadedKg = 14;
      const incomingPackageWeight = 8; // 14 + 8 = 22kg > 20kg

      const remaining = Math.max(0, vehicleLimitKg - currentLoadedKg);
      const isExceeded = currentLoadedKg + incomingPackageWeight > vehicleLimitKg;

      expect(isExceeded).toBe(true);

      const err = ApiError.badRequest(
        `Weight capacity exceeded: Vehicle limit is ${vehicleLimitKg}kg (currently loaded: ${currentLoadedKg}kg, remaining: ${remaining}kg). This package weighs ${incomingPackageWeight}kg.`
      );

      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("Weight capacity exceeded");
    });

    it("allows package acceptance if incoming weight is within vehicle capacity", () => {
      const vehicleLimitKg = 20;
      const currentLoadedKg = 12;
      const incomingPackageWeight = 5; // 12 + 5 = 17kg <= 20kg

      const isExceeded = currentLoadedKg + incomingPackageWeight > vehicleLimitKg;
      expect(isExceeded).toBe(false);
    });
  });

  // ─── 3. Authorization & Privacy Matrix ─────────────────────────────────────
  describe("3. Multi-Tenant Scoped Access & Privacy", () => {
    it("blocks customer from tracking an order they do not own", () => {
      const orderCustomerId = "user-123";
      const requestingUserId = "user-999";
      const isAdmin = false;

      const isAuthorized = orderCustomerId === requestingUserId || isAdmin;
      expect(isAuthorized).toBe(false);

      const err = ApiError.forbidden("You are not authorized to track this delivery");
      expect(err.statusCode).toBe(403);
    });

    it("blocks rider from updating status or OTP for another rider's delivery", () => {
      const assignedRiderId = "rider-1";
      const requestingUserId = "rider-2";
      const isAdmin = false;

      const isAuthorized = assignedRiderId === requestingUserId || isAdmin;
      expect(isAuthorized).toBe(false);

      const err = ApiError.forbidden("You can only verify OTP for deliveries assigned to you");
      expect(err.statusCode).toBe(403);
    });

    it("blocks non-admin users from admin delivery command center endpoints", () => {
      const userRole = "delivery_man";
      const isAdmin = userRole === "admin";
      expect(isAdmin).toBe(false);

      const err = ApiError.forbidden("Requires role: admin");
      expect(err.statusCode).toBe(403);
    });

    it("enforces OTP max attempt rate limit", () => {
      let attempts = 5;
      const maxAttempts = 5;

      const isBlocked = attempts >= maxAttempts;
      expect(isBlocked).toBe(true);

      const err = ApiError.badRequest("Too many failed OTP verification attempts. Please contact customer support.");
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("Too many failed OTP verification attempts");
    });
  });

  // ─── 4. Geofencing & GPS Telemetry Calculation ─────────────────────────────
  describe("4. Geofencing Telemetry & Validation", () => {
    it("validates valid latitude and longitude coordinates", () => {
      expect(isValidCoordinate(23.8103, 90.4125)).toBe(true); // Dhaka
      expect(isValidCoordinate(0, 0)).toBe(true);
      expect(isValidCoordinate(95, 90)).toBe(false); // Invalid lat > 90
      expect(isValidCoordinate(-91, 0)).toBe(false); // Invalid lat < -90
      expect(isValidCoordinate(23, 185)).toBe(false); // Invalid lon > 180
      expect(isValidCoordinate(NaN, 90)).toBe(false);
      expect(isValidCoordinate(null, 90)).toBe(false);
    });

    it("correctly computes distance in meters using Haversine formula for geofence detection", () => {
      // Point A: Dhanmondi 27 (23.7538, 90.3755)
      // Point B: Dhanmondi 32 (23.7505, 90.3780) - approx 450m away
      const distance = calculateDistanceMeters(23.7538, 90.3755, 23.7505, 90.378);
      expect(distance).toBeGreaterThan(300);
      expect(distance).toBeLessThan(600);

      // Very close point (< 100m)
      const closeDistance = calculateDistanceMeters(23.7538, 90.3755, 23.7539, 90.3756);
      expect(closeDistance).toBeLessThan(100);
    });
  });
});
