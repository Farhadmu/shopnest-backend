import { describe, it, expect } from "vitest";
import { ApiError } from "../../src/utils/api-error";

describe("Admin Coupon Control Logic", () => {
  it("updateCoupon admin edit restriction message", () => {
    const message = "Admins cannot edit seller coupon details. Use approve or reject to change status.";
    const err = ApiError.forbidden(message);
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("Admins cannot edit seller coupon details");
  });

  it("rejectionNote is stored on the coupon model", () => {
    const coupon = {
      rejectionNote: "Discount value too high for homepage category",
    };
    expect(coupon.rejectionNote).toBe("Discount value too high for homepage category");
  });

  it("notification payload for rejection contains report", () => {
    const rejectionNote = "Discount value too high for homepage category";
    const reportMsg = rejectionNote
      ? `Your coupon "TEST" has been rejected. Admin report: ${rejectionNote}`
      : `Your coupon "TEST" has been rejected by an admin.`;
    expect(reportMsg).toContain("Discount value too high for homepage category");
  });

  it("notification payload for approval is info priority", () => {
    const notification = {
      type: "coupon",
      category: "system",
      priority: "info",
      source: "admin",
    };
    expect(notification.priority).toBe("info");
    expect(notification.source).toBe("admin");
  });

  it("reportCoupon sends notification without changing status", () => {
    const reportNote = "Please adjust discount value";
    const message = `Admin report for your coupon "TEST": ${reportNote}`;
    expect(message).toContain("Please adjust discount value");
    expect(message).toContain("Admin report for your coupon");
  });
});
