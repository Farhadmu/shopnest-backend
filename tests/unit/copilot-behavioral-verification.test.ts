import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response } from "express";
import { requireRole } from "../../src/middlewares/role.middleware";
import * as customerService from "../../src/modules/ai/customer-copilot/customer-copilot.service";
import * as sellerService from "../../src/modules/ai/seller-copilot/seller-copilot.service";
import { customerCopilotController } from "../../src/modules/ai/customer-copilot/customer-copilot.controller";
import { sellerCopilotController } from "../../src/modules/ai/seller-copilot/seller-copilot.controller";
import { adminCopilotController } from "../../src/modules/ai/admin-copilot/admin-copilot.controller";
import * as adminService from "../../src/modules/ai/admin-copilot/admin-copilot.service";
import { Store } from "../../src/modules/sellers/store.model";
import aiRoutes from "../../src/modules/ai/ai.routes";
import advisorRoutes from "../../src/modules/ai/advisor/advisor.routes";

function createMockResponse() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("Target 6 — Copilot MVP Behavioral Verification & Read-Only Intelligence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Sensitive Ownership Identifiers (req.user vs req.body)", () => {
    it("Customer Copilot extracts userId strictly from req.user and ignores spoofed body ids", async () => {
      const handleSpy = vi.spyOn(customerService, "handleCustomerCopilotQuery").mockResolvedValue({
        answer: "Orders retrieved",
        suggestedActions: [],
        isFallback: false,
      });

      const req: Partial<Request> = {
        user: { id: "legit-customer-123", email: "cust@shopnest.com", name: "Alice", role: "customer" },
        body: {
          query: "Where is my package?",
          userId: "malicious-attacker-999",
          customerId: "malicious-attacker-999",
        },
      };
      const res = createMockResponse();

      await customerCopilotController(req as Request, res, vi.fn());

      // Ensure service is called with the authenticated ID from req.user
      expect(handleSpy).toHaveBeenCalledTimes(1);
      expect(handleSpy).toHaveBeenCalledWith("Where is my package?", "legit-customer-123");
      expect(handleSpy).not.toHaveBeenCalledWith(expect.anything(), "malicious-attacker-999");
    });

    it("Seller Copilot extracts sellerId strictly from req.user and ignores spoofed body ids", async () => {
      const handleSpy = vi.spyOn(sellerService, "handleSellerCopilotQuery").mockResolvedValue({
        answer: "Store data retrieved",
        suggestedActions: [],
        isFallback: false,
      });

      const req: Partial<Request> = {
        user: { id: "legit-seller-456", email: "seller@shopnest.com", name: "Bob", role: "seller" },
        body: {
          query: "What is my revenue?",
          sellerId: "malicious-seller-999",
          storeId: "malicious-store-999",
        },
      };
      const res = createMockResponse();

      await sellerCopilotController(req as Request, res, vi.fn());

      expect(handleSpy).toHaveBeenCalledTimes(1);
      expect(handleSpy).toHaveBeenCalledWith("What is my revenue?", "legit-seller-456");
      expect(handleSpy).not.toHaveBeenCalledWith(expect.anything(), "malicious-seller-999");
    });

    it("Rejects Customer Copilot request with 401 when req.user is absent", async () => {
      const req: Partial<Request> = {
        body: { query: "Where is my order?" },
      };
      const res = createMockResponse();
      const next = vi.fn();

      await customerCopilotController(req as Request, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: "Authentication required",
        })
      );
    });

    it("Rejects Seller Copilot request with 401 when req.user is absent", async () => {
      const req: Partial<Request> = {
        body: { query: "How is my store doing?" },
      };
      const res = createMockResponse();
      const next = vi.fn();

      await sellerCopilotController(req as Request, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: "Authentication required",
        })
      );
    });
  });

  describe("2. Role Boundary Enforcement", () => {
    const customerMiddleware = requireRole("customer");
    const sellerMiddleware = requireRole("seller");
    const adminMiddleware = requireRole("admin");

    it("Customer endpoint blocks seller and admin roles with 403 Forbidden", () => {
      const sellerReq = { user: { id: "1", email: "", name: "", role: "seller" } } as Request;
      const adminReq = { user: { id: "2", email: "", name: "", role: "admin" } } as Request;
      const customerReq = { user: { id: "3", email: "", name: "", role: "customer" } } as Request;

      const nextSeller = vi.fn();
      const nextAdmin = vi.fn();
      const nextCustomer = vi.fn();

      customerMiddleware(sellerReq, {} as Response, nextSeller);
      expect(nextSeller).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

      customerMiddleware(adminReq, {} as Response, nextAdmin);
      expect(nextAdmin).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

      customerMiddleware(customerReq, {} as Response, nextCustomer);
      expect(nextCustomer).toHaveBeenCalledWith(); // allowed
    });

    it("Seller endpoint blocks customer and admin roles with 403 Forbidden", () => {
      const customerReq = { user: { id: "1", email: "", name: "", role: "customer" } } as Request;
      const adminReq = { user: { id: "2", email: "", name: "", role: "admin" } } as Request;
      const sellerReq = { user: { id: "3", email: "", name: "", role: "seller" } } as Request;

      const nextCustomer = vi.fn();
      const nextAdmin = vi.fn();
      const nextSeller = vi.fn();

      sellerMiddleware(customerReq, {} as Response, nextCustomer);
      expect(nextCustomer).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

      sellerMiddleware(adminReq, {} as Response, nextAdmin);
      expect(nextAdmin).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

      sellerMiddleware(sellerReq, {} as Response, nextSeller);
      expect(nextSeller).toHaveBeenCalledWith(); // allowed
    });

    it("Admin endpoint blocks customer and seller roles with 403 Forbidden", () => {
      const customerReq = { user: { id: "1", email: "", name: "", role: "customer" } } as Request;
      const sellerReq = { user: { id: "2", email: "", name: "", role: "seller" } } as Request;
      const adminReq = { user: { id: "3", email: "", name: "", role: "admin" } } as Request;

      const nextCustomer = vi.fn();
      const nextSeller = vi.fn();
      const nextAdmin = vi.fn();

      adminMiddleware(customerReq, {} as Response, nextCustomer);
      expect(nextCustomer).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

      adminMiddleware(sellerReq, {} as Response, nextSeller);
      expect(nextSeller).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

      adminMiddleware(adminReq, {} as Response, nextAdmin);
      expect(nextAdmin).toHaveBeenCalledWith(); // allowed
    });
  });

  describe("3. Seller Data Isolation & Read-Only Store Resolution", () => {
    it("Seller Copilot does NOT return another seller's store if the seller has no store", async () => {
      // Mock Store.findOne to return null (seller has no registered store)
      vi.spyOn(Store, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as any);

      const res = await sellerService.handleSellerCopilotQuery(
        "What is my inventory status?",
        "unregistered-seller-id"
      );

      // Verify it returns a setup prompt without crashing or leaking other stores
      expect(res.isFallback).toBe(true);
      expect(res.answer).toContain("You do not have an active store registered");
      expect(res.suggestedActions.some((a) => a.targetUrl === "/seller/store/setup")).toBe(true);
    });
  });

  describe("4. Admin Copilot Rich Response Preservation", () => {
    it("preserves rich structured response fields on admin copilot queries", async () => {
      const mockAdminResponse = {
        answer: "Marketplace GMV is strong this week.",
        summary: "Marketplace GMV is strong this week.",
        intent: "GMV_ANALYSIS" as any,
        confidence: 0.95,
        timeRange: { start: new Date(), end: new Date(), label: "Last 7 days" },
        metrics: [{ label: "GMV", value: 150000, formatted: "৳150,000", trend: "up" as const }],
        insights: [{ severity: "info" as const, title: "Healthy Growth", description: "12% increase" }],
        sources: [{ name: "Orders DB", type: "database" as const }],
        suggestedActions: [{ label: "View Analytics", action: "navigate" as const, targetUrl: "/dashboard" }],
        isFallback: false,
      };

      vi.spyOn(adminService, "handleAdminCopilotQuery").mockResolvedValue(mockAdminResponse);

      const req: Partial<Request> = {
        user: { id: "admin-1", email: "admin@shopnest.com", name: "Admin", role: "admin" },
        body: { query: "What is our GMV performance?" },
      };
      const res = createMockResponse();

      await adminCopilotController(req as Request, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          metrics: expect.any(Array),
          insights: expect.any(Array),
          sources: expect.any(Array),
          timeRange: expect.any(Object),
          intent: "GMV_ANALYSIS",
        })
      );
    });
  });

  describe("5. Product Advisor Route Separation", () => {
    it("Product Advisor is mounted at separate /chat endpoint and not conflated with copilots", () => {
      expect(advisorRoutes).toBeDefined();
      const routes = aiRoutes.stack.map((layer: any) => layer.regexp.toString());
      const chatRouteMounted = routes.some((r: string) => r.includes("chat"));
      expect(chatRouteMounted).toBe(true);
    });
  });
});
