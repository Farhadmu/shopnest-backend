import { describe, it, expect } from "vitest";
import {
  createIncidentSchema,
  rateDeliverySchema,
  updateLocationSchema,
  reportIncidentSchema,
} from "../../src/schemas/delivery.schema";
import {
  getApproxCoordinatesFromAddress,
  calculateDistanceMeters,
  isValidCoordinate,
} from "../../src/utils/geo";

describe("Delivery Incident, Rating & Logistics Telemetry Test Suite", () => {
  describe("1. Incident Reporting Schemas (General & Order-Linked)", () => {
    it("validates general incident without delivery/order ID", () => {
      const payload = {
        category: "technical_issue",
        severity: "medium",
        description: "Road is blocked due to road construction, delays expected across central zone.",
      };

      const parsed = createIncidentSchema.parse(payload);
      expect(parsed.category).toBe("technical_issue");
      expect(parsed.severity).toBe("medium");
      expect(parsed.description).toBe(payload.description);
      expect(parsed.orderId).toBeUndefined();
      expect(parsed.deliveryRequestId).toBeUndefined();
    });

    it("validates order-linked incident with orderId", () => {
      const payload = {
        orderId: "507f1f77bcf86cd799439011",
        category: "customer_unavailable",
        severity: "high",
        description: "Called customer 4 times, phone switched off at gate.",
        evidenceImages: ["https://example.com/gate.jpg"],
      };

      const parsed = createIncidentSchema.parse(payload);
      expect(parsed.orderId).toBe("507f1f77bcf86cd799439011");
      expect(parsed.category).toBe("customer_unavailable");
      expect(parsed.severity).toBe("high");
      expect(parsed.evidenceImages).toHaveLength(1);
    });

    it("rejects invalid incident category or too short description", () => {
      expect(() => {
        createIncidentSchema.parse({
          category: "invalid_category",
          description: "desc",
        });
      }).toThrow();
    });

    it("validates reportIncidentSchema with valid fields", () => {
      const parsed = reportIncidentSchema.parse({
        category: "vehicle_problem",
        severity: "critical",
        description: "Minor bike breakdown near Mirpur 10",
      });
      expect(parsed.category).toBe("vehicle_problem");
      expect(parsed.severity).toBe("critical");
    });

    it("accepts operational category synonyms (traffic, weather, vehicle_breakdown, package_damaged)", () => {
      const traffic = createIncidentSchema.parse({
        category: "traffic",
        severity: "high",
        description: "Severe gridlock on Dhaka-Chattogram highway near Comilla",
      });
      expect(traffic.category).toBe("traffic");

      const weather = createIncidentSchema.parse({
        category: "weather",
        severity: "critical",
        description: "Flash flooding preventing courier transit",
      });
      expect(weather.category).toBe("weather");

      const breakdown = createIncidentSchema.parse({
        category: "vehicle_breakdown",
        severity: "medium",
        description: "Flat tire on delivery motorcycle",
      });
      expect(breakdown.category).toBe("vehicle_breakdown");
    });
  });

  describe("2. Customer Rating Validation & Average Calculation", () => {
    it("validates valid rating payload (1 to 5 stars)", () => {
      const payload = {
        rating: 5,
        professionalism: 5,
        timeliness: 4,
        comment: "Exceptional delivery service, very polite!",
      };
      const parsed = rateDeliverySchema.parse(payload);
      expect(parsed.rating).toBe(5);
      expect(parsed.professionalism).toBe(5);
      expect(parsed.comment).toBe(payload.comment);
    });

    it("rejects invalid rating values (<1 or >5 or non-integer)", () => {
      expect(() => rateDeliverySchema.parse({ rating: 0 })).toThrow();
      expect(() => rateDeliverySchema.parse({ rating: 6 })).toThrow();
      expect(() => rateDeliverySchema.parse({ rating: 4.5 })).toThrow();
    });

    it("calculates accurate incremental delivery partner rating average", () => {
      const existingReviews = [
        { rating: 5 },
        { rating: 4 },
        { rating: 5 },
        { rating: 4 },
      ];
      const newRating = 5;
      const allRatings = [...existingReviews.map((r) => r.rating), newRating];
      const avg = Number((allRatings.reduce((sum, r) => sum + r, 0) / allRatings.length).toFixed(1));

      expect(avg).toBe(4.6);
      expect(allRatings.length).toBe(5);
    });
  });

  describe("3. Real Geocoding & No-Fake-Dhaka-Fallback", () => {
    it("returns null for unrecognized or empty addresses rather than fake Dhaka coords", () => {
      expect(getApproxCoordinatesFromAddress("Random non-existent fictional planet")).toBeNull();
      expect(getApproxCoordinatesFromAddress("   ")).toBeNull();
      expect(getApproxCoordinatesFromAddress(undefined)).toBeNull();
    });

    it("accurately detects known Bangladesh divisional centroids and major hubs", () => {
      const sylhet = getApproxCoordinatesFromAddress("Ambarkhana, Sylhet");
      expect(sylhet).not.toBeNull();
      expect(sylhet?.latitude).toBeCloseTo(24.8949, 1);

      const rajshahi = getApproxCoordinatesFromAddress("Shaheb Bazar, Rajshahi");
      expect(rajshahi).not.toBeNull();
      expect(rajshahi?.latitude).toBeCloseTo(24.37, 1);

      const khulna = getApproxCoordinatesFromAddress("Shibbari Mor, Khulna");
      expect(khulna).not.toBeNull();
      expect(khulna?.latitude).toBeCloseTo(22.8456, 1);
    });

    it("verifies accurate Haversine calculation between Dhaka and Chattogram", () => {
      const dist = calculateDistanceMeters(23.8103, 90.4125, 22.3569, 91.7832);
      // Distance is ~215-225km
      expect(dist).toBeGreaterThan(200000);
      expect(dist).toBeLessThan(250000);
    });

    it("validates coordinate boundaries correctly", () => {
      expect(isValidCoordinate(23.8103, 90.4125)).toBe(true);
      expect(isValidCoordinate(95.0, 90.0)).toBe(false);
      expect(isValidCoordinate(23.0, 200.0)).toBe(false);
    });
  });

  describe("4. Telemetry Schema & Speed/Heading/Accuracy", () => {
    it("validates full live telemetry payload from delivery partner GPS", () => {
      const payload = {
        latitude: 23.7925,
        longitude: 90.4078,
        speed: 28.5,
        heading: 180,
        accuracy: 4.2,
      };

      const parsed = updateLocationSchema.parse(payload);
      expect(parsed.latitude).toBe(23.7925);
      expect(parsed.longitude).toBe(90.4078);
      expect(parsed.speed).toBe(28.5);
      expect(parsed.heading).toBe(180);
      expect(parsed.accuracy).toBe(4.2);
    });

    it("rejects out-of-range coordinates", () => {
      expect(() => {
        updateLocationSchema.parse({
          latitude: 195.0,
          longitude: 90.0,
        });
      }).toThrow();
    });
  });
});
