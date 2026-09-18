import { describe, it, expect, vi, beforeEach } from "vitest";

const productMocks = vi.hoisted(() => ({
  findById: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../../src/modules/products/product.model", () => ({
  Product: productMocks,
}));

vi.mock("../../src/modules/sellers/store.model", () => ({
  Store: storeMocks,
}));

import { getPurchaseDecisionScore } from "../../src/modules/customer/features/decision-score.controller";

describe("getPurchaseDecisionScore controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws 404 when product is not found", async () => {
    productMocks.findById.mockResolvedValue(null);

    const req = { params: { productId: "nonexistent-id" } } as any;
    const res = {} as any;
    const next = vi.fn();

    await getPurchaseDecisionScore(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it("returns insufficientData: true when product has 0 ratings and 0 sales", async () => {
    productMocks.findById.mockResolvedValue({
      id: "prod-1",
      storeId: "store-1",
      ratingAvg: 0,
      ratingCount: 0,
      sold: 0,
      price: 100,
      stock: 20,
    });
    storeMocks.findById.mockResolvedValue({
      id: "store-1",
      storeName: "Test Store",
      trustScore: 80,
    });

    const req = { params: { productId: "prod-1" } } as any;
    const jsonMock = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as any;
    const next = vi.fn();

    await getPurchaseDecisionScore(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const sentData = jsonMock.mock.calls[0][0];
    expect(sentData.insufficientData).toBe(true);
    expect(sentData.overallScore).toBeUndefined();
  });

  it("returns authentic score when product has sales even without ratings", async () => {
    productMocks.findById.mockResolvedValue({
      id: "prod-sold-only",
      storeId: "store-1",
      ratingAvg: 0,
      ratingCount: 0,
      sold: 5,
      price: 1200,
      discountPrice: 1000,
      stock: 20,
    });
    storeMocks.findById.mockResolvedValue({
      id: "store-1",
      storeName: "Test Store",
      trustScore: 80,
    });

    const req = { params: { productId: "prod-sold-only" } } as any;
    const jsonMock = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as any;
    const next = vi.fn();

    await getPurchaseDecisionScore(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const sentData = jsonMock.mock.calls[0][0];
    expect(sentData.insufficientData).toBe(false);
    expect(typeof sentData.overallScore).toBe("number");
    expect(sentData.overallScore).toBeGreaterThan(0);
    expect(sentData.dimensions.popularity.note).toContain("5 units");
  });

  it("returns authentic score and dimensions when product has real data", async () => {
    productMocks.findById.mockResolvedValue({
      id: "prod-2",
      storeId: "store-1",
      ratingAvg: 4.8,
      ratingCount: 15,
      sold: 45,
      price: 1000,
      discountPrice: 800,
      stock: 12,
      sentiment: { positive: 4 },
    });
    storeMocks.findById.mockResolvedValue({
      id: "store-1",
      storeName: "Super Store",
      trustScore: 92,
    });

    const req = { params: { productId: "prod-2" } } as any;
    const jsonMock = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonMock }),
    } as any;
    const next = vi.fn();

    await getPurchaseDecisionScore(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const sentData = jsonMock.mock.calls[0][0];
    expect(sentData.insufficientData).toBe(false);
    expect(typeof sentData.overallScore).toBe("number");
    expect(sentData.overallScore).toBeGreaterThan(0);
    expect(sentData.dimensions).toBeDefined();
    expect(sentData.dimensions.quality.label).toBe("Verified Quality");
    expect(sentData.dimensions.quality.note).toContain("4.8/5");
    expect(sentData.dimensions.popularity.note).toContain("45 units");
    expect(sentData.dimensions.reliability.note).toContain("Super Store");
    expect(sentData.recommendation).toBeDefined();
  });
});
