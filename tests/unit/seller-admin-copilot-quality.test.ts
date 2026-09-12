import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/ai/providers/gemini.provider", () => ({
  completeWithContext: vi.fn(),
}));
vi.mock("../../src/modules/ai/incident/incident.service", () => ({
  logAiIncident: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/modules/security/auditLog.model", () => ({
  AuditLog: { create: vi.fn().mockResolvedValue(undefined) },
}));

import { Store } from "../../src/modules/sellers/store.model";
import { Product } from "../../src/modules/products/product.model";
import { Order } from "../../src/modules/orders/order.model";
import * as aiProvider from "../../src/modules/ai/providers/gemini.provider";
import { handleSellerCopilotQuery } from "../../src/modules/ai/seller-copilot/seller-copilot.service";
import { getTelemetrySummary } from "../../src/modules/ai/admin-copilot/admin-copilot.tools";

function queryChain<T>(value: T) {
  const chain = {
    sort: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    lean: vi.fn().mockResolvedValue(value),
  };
  return chain;
}

describe("Seller and Admin Copilot quality", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(aiProvider.completeWithContext).mockResolvedValue({ content: "grounded", isFallback: false });
  });

  it("passes seller-owned valid sales and real top-product data to the provider", async () => {
    const storeId = { toString: () => "store-1" };
    const product = {
      _id: { toString: () => "product-1" },
      title: "Seller Phone",
      price: 1000,
      category: "Phones",
      stock: 3,
      ratingAvg: 4.2,
      status: "approved",
      isDeleted: false,
    };
    const orders = [
      {
        _id: { toString: () => "order-valid" },
        status: "delivered",
        totalAmount: 2000,
        items: [{ productId: "product-1", storeId: "store-1", price: 1000, quantity: 2 }],
      },
      {
        _id: { toString: () => "order-cancelled" },
        status: "cancelled",
        totalAmount: 9000,
        items: [{ productId: "product-1", storeId: "store-1", price: 1000, quantity: 9 }],
      },
    ];

    vi.spyOn(Store, "findOne").mockReturnValue(queryChain({
      _id: storeId,
      ownerId: "seller-1",
      storeName: "Seller Store",
      status: "approved",
      rating: 4.2,
      trustScore: 72,
    }) as any);
    vi.spyOn(Product, "find").mockReturnValue(queryChain([product]) as any);
    vi.spyOn(Order, "find")
      .mockReturnValueOnce(queryChain(orders) as any)
      .mockReturnValueOnce(queryChain([]) as any);

    await handleSellerCopilotQuery("How are my sales doing?", "seller-1");

    const context = vi.mocked(aiProvider.completeWithContext).mock.calls[0][1] as any;
    expect(context.userContext.recentStoreRevenue).toBe(2000);
    expect(context.userContext.recentUnitsSold).toBe(2);
    expect(context.userContext.cancelledOrdersCount).toBe(1);
    expect(context.userContext.topProducts).toEqual([
      expect.objectContaining({ title: "Seller Phone", unitsSold: 2, revenue: 2000, category: "Phones" }),
    ]);
    expect(context.userContext.recentStoreRevenue).not.toBe(11000);
  });

  it("does not fabricate seller health metrics when the store has no values", async () => {
    const storeId = { toString: () => "store-1" };
    vi.spyOn(Store, "findOne").mockReturnValue(queryChain({
      _id: storeId,
      ownerId: "seller-1",
      storeName: "Seller Store",
      status: "approved",
    }) as any);
    vi.spyOn(Product, "find").mockReturnValue(queryChain([]) as any);
    vi.spyOn(Order, "find")
      .mockReturnValueOnce(queryChain([]) as any)
      .mockReturnValueOnce(queryChain([]) as any);

    await handleSellerCopilotQuery("What's my store health?", "seller-1");

    const context = vi.mocked(aiProvider.completeWithContext).mock.calls[0][1] as any;
    expect(context.userContext.storeRating).toBeNull();
    expect(context.userContext.trustScore).toBeNull();
    expect(context.userContext.healthStatus).toBe("Unavailable");
  });

  it("does not expose fabricated admin telemetry", async () => {
    await expect(getTelemetrySummary()).resolves.toEqual({
      overallStatus: "unavailable",
      uptime: "unavailable",
      p95LatencyMs: null,
      averageLatencyMs: null,
      endpoints: [],
    });
  });
});