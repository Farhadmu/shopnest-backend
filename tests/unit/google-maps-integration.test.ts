import { describe, it, expect } from "vitest";
import {
  isValidCoordinate,
  calculateDistanceMeters,
  BD_DIVISION_COORDINATES,
  getApproxCoordinatesFromAddress,
} from "../../src/utils/geo";

describe("Google Maps & Bangladesh Geographic Logistics Integration", () => {
  it("resolves exact and approximate coordinates for Bangladesh divisions & hubs", () => {
    // Dhaka
    const dhaka = getApproxCoordinatesFromAddress("House 12, Road 5, Dhanmondi, Dhaka");
    expect(dhaka).toBeDefined();
    expect(dhaka?.latitude).toBeCloseTo(23.7465, 2);
    expect(dhaka?.longitude).toBeCloseTo(90.376, 2);

    // Chattogram
    const ctg = getApproxCoordinatesFromAddress("GEC Circle, Chattogram, Bangladesh");
    expect(ctg).toBeDefined();
    expect(ctg?.latitude).toBeCloseTo(22.3569, 2);
    expect(ctg?.longitude).toBeCloseTo(91.7832, 2);

    // Sylhet
    const sylhet = getApproxCoordinatesFromAddress("Zindabazar, Sylhet 3100");
    expect(sylhet).toBeDefined();
    expect(sylhet?.latitude).toBeCloseTo(24.8949, 2);
    expect(sylhet?.longitude).toBeCloseTo(91.8687, 2);

    // Cumilla
    const cumilla = getApproxCoordinatesFromAddress("Kandirpar, Cumilla Sadar");
    expect(cumilla).toBeDefined();
    expect(cumilla?.latitude).toBeCloseTo(23.4607, 2);
    expect(cumilla?.longitude).toBeCloseTo(91.1809, 2);

    // Uttara
    const uttara = getApproxCoordinatesFromAddress("Sector 3, Uttara, Dhaka-1230");
    expect(uttara).toBeDefined();
    expect(uttara?.latitude).toBeCloseTo(23.8759, 2);
    expect(uttara?.longitude).toBeCloseTo(90.3795, 2);
  });

  it("handles null or empty address strings without crashing", () => {
    expect(getApproxCoordinatesFromAddress(undefined)).toBeNull();
    expect(getApproxCoordinatesFromAddress("")).toBeNull();
  });

  it("calculates real Haversine distance between Dhanmondi and Gulshan", () => {
    const dhanmondi = BD_DIVISION_COORDINATES.dhanmondi;
    const gulshan = BD_DIVISION_COORDINATES.gulshan;
    const distanceMeters = calculateDistanceMeters(
      dhanmondi.latitude,
      dhanmondi.longitude,
      gulshan.latitude,
      gulshan.longitude
    );

    // Real straight-line distance between Dhanmondi & Gulshan is ~6.1km
    expect(distanceMeters).toBeGreaterThan(5000);
    expect(distanceMeters).toBeLessThan(7000);
  });

  it("validates coordinate boundaries accurately for Bangladesh coordinates", () => {
    expect(isValidCoordinate(23.8103, 90.4125)).toBe(true); // Dhaka
    expect(isValidCoordinate(22.3569, 91.7832)).toBe(true); // Chattogram
    expect(isValidCoordinate(95.0, 90.0)).toBe(false); // Invalid latitude
    expect(isValidCoordinate(23.0, 200.0)).toBe(false); // Invalid longitude
    expect(isValidCoordinate("23.0", 90.0)).toBe(false); // Non-number
    expect(isValidCoordinate(NaN, 90.0)).toBe(false);
  });
});
