import { describe, it, expect } from "vitest";
import { ApiError } from "../../src/utils/api-error";

describe("Coupon Category Limit Validation Logic", () => {
  function checkCategoryLimit(categoriesCount: number, categoryLimit: number, placement: string = "homepage") {
    if (placement !== "homepage") return;
    if (categoriesCount > categoryLimit) {
      throw ApiError.badRequest(
        `You cannot select ${categoriesCount} categories for homepage coupons. Platform limit set by admin is ${categoryLimit}.`
      );
    }
  }

  it("allows selecting categories within the admin limit for homepage coupons", () => {
    expect(() => checkCategoryLimit(2, 3, "homepage")).not.toThrow();
    expect(() => checkCategoryLimit(3, 3, "homepage")).not.toThrow();
  });

  it("allows selecting any number of categories for non-homepage (e.g. store) coupons", () => {
    expect(() => checkCategoryLimit(5, 3, "store")).not.toThrow();
    expect(() => checkCategoryLimit(10, 3, "private")).not.toThrow();
  });

  it("throws badRequest 400 when selecting categories exceeding the admin limit for homepage coupons", () => {
    try {
      checkCategoryLimit(4, 3, "homepage");
      expect.fail("Should have thrown ApiError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe("You cannot select 4 categories for homepage coupons. Platform limit set by admin is 3.");
    }
  });
});
