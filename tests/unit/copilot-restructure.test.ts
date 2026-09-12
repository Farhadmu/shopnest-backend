import { describe, it, expect } from "vitest";
import { customerCopilotQuerySchema } from "../../src/modules/ai/customer-copilot/customer-copilot.schemas";
import { sellerCopilotQuerySchema } from "../../src/modules/ai/seller-copilot/seller-copilot.schemas";
import { adminCopilotQuerySchema } from "../../src/modules/ai/admin-copilot/admin-copilot.schemas";
import aiRoutes from "../../src/modules/ai/ai.routes";
import customerCopilotRoutes from "../../src/modules/ai/customer-copilot/customer-copilot.routes";
import sellerCopilotRoutes from "../../src/modules/ai/seller-copilot/seller-copilot.routes";
import adminCopilotRoutes from "../../src/modules/ai/admin-copilot/admin-copilot.routes";

describe("AI Copilot Restructure Verification", () => {
  describe("Zod Validation Schemas", () => {
    it("customerCopilotQuerySchema accepts valid query and optional context", () => {
      const valid = customerCopilotQuerySchema.safeParse({
        query: "Where is my latest order?",
        context: { orderId: "123" },
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.query).toBe("Where is my latest order?");
      }
    });

    it("customerCopilotQuerySchema rejects empty query", () => {
      const invalid = customerCopilotQuerySchema.safeParse({ query: "" });
      expect(invalid.success).toBe(false);
    });

    it("sellerCopilotQuerySchema accepts valid query and optional context", () => {
      const valid = sellerCopilotQuerySchema.safeParse({
        query: "What items are running low on stock?",
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.query).toBe("What items are running low on stock?");
      }
    });

    it("sellerCopilotQuerySchema rejects query longer than 2000 characters", () => {
      const invalid = sellerCopilotQuerySchema.safeParse({ query: "a".repeat(2001) });
      expect(invalid.success).toBe(false);
    });

    it("adminCopilotQuerySchema accepts valid query and optional context", () => {
      const valid = adminCopilotQuerySchema.safeParse({
        query: "Give me an executive summary of GMV this month",
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("Copilot Sub-routers Export", () => {
    it("exports customerCopilotRoutes router", () => {
      expect(customerCopilotRoutes).toBeDefined();
      expect(typeof customerCopilotRoutes).toBe("function");
    });

    it("exports sellerCopilotRoutes router", () => {
      expect(sellerCopilotRoutes).toBeDefined();
      expect(typeof sellerCopilotRoutes).toBe("function");
    });

    it("exports adminCopilotRoutes router", () => {
      expect(adminCopilotRoutes).toBeDefined();
      expect(typeof adminCopilotRoutes).toBe("function");
    });
  });

  describe("Mounted AI Routes Structure", () => {
    it("mounts customer-copilot, seller-copilot, and admin-copilot in aiRoutes router", () => {
      const registeredPaths = aiRoutes.stack
        .filter((layer: any) => layer.regexp)
        .map((layer: any) => layer.regexp.toString());

      // Check customer-copilot
      const hasCustomerCopilot = registeredPaths.some((p: string) =>
        p.includes("customer-copilot")
      );
      expect(hasCustomerCopilot).toBe(true);

      // Check seller-copilot
      const hasSellerCopilot = registeredPaths.some((p: string) =>
        p.includes("seller-copilot")
      );
      expect(hasSellerCopilot).toBe(true);

      // Check admin-copilot
      const hasAdminCopilot = registeredPaths.some((p: string) =>
        p.includes("admin-copilot")
      );
      expect(hasAdminCopilot).toBe(true);

      // Verify old generic /copilot route is NOT mounted
      const hasOldGenericCopilot = registeredPaths.some(
        (p: string) => p.includes("\\/copilot\\/?") || p.includes("/copilot")
      );
      expect(hasOldGenericCopilot).toBe(false);
    });
  });
});
