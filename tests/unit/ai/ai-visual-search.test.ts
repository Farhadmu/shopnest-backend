import { describe, it, expect, vi, beforeEach } from "vitest";

const productMocks = vi.hoisted(() => ({
  find: vi.fn(),
  countDocuments: vi.fn(),
}));

const demandMocks = vi.hoisted(() => ({
  create: vi.fn(),
  find: vi.fn(),
  countDocuments: vi.fn(),
  aggregate: vi.fn(),
  findByIdAndUpdate: vi.fn(),
  findByIdAndDelete: vi.fn(),
}));

vi.mock("../../../src/modules/products/product.model", () => ({
  Product: productMocks,
}));

vi.mock("../../../src/modules/ai/visual-search-demand.model", () => ({
  VisualSearchDemand: demandMocks,
}));

vi.mock("../../../src/utils/activeProductFilter", () => ({
  buildPublicProductFilter: vi.fn().mockResolvedValue({ isDeleted: false }),
  getPublicProduct: vi.fn(),
}));

describe("AI Visual Search & Seller Demand Insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should record visual search demand and return matching products", async () => {
    const mockProducts = [
      {
        _id: "prod_1",
        title: "Wireless Bluetooth Over-Ear Headphones",
        category: "Electronics",
        price: 3500,
        discountPrice: 3200,
        tags: ["headphones", "wireless", "audio"],
        images: ["/uploads/headphones.jpg"],
        ratingAvg: 4.8,
        sold: 50,
      },
    ];

    const chainableFind = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(mockProducts),
    };

    productMocks.find.mockReturnValue(chainableFind);

    demandMocks.create.mockResolvedValue({
      _id: "demand_123",
      detectedTitle: "Wireless Bluetooth Headphones",
      isUnmetDemand: false,
    });

    const { visualSearch } = await import("../../../src/modules/ai/ai.controller");

    const req: any = {
      body: {
        imageUrl: "/uploads/visual-search/wireless-headphone.jpg",
        searchQuery: "Wireless Headphone",
      },
      user: { id: "cust_1" },
    };

    let responseData: any = null;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
        return res;
      }),
    };

    await visualSearch(req, res, () => {});

    expect(responseData).toBeDefined();
    expect(responseData.success).toBe(true);
    expect(responseData.count).toBe(1);
    expect(responseData.products[0].matchScore).toBeGreaterThanOrEqual(50);
    expect(demandMocks.create).toHaveBeenCalledTimes(1);
  });

  it("should mark isUnmetDemand as true when 0 catalog matches are found", async () => {
    const chainableEmptyFind = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
    };

    productMocks.find.mockReturnValue(chainableEmptyFind);

    demandMocks.create.mockResolvedValue({
      _id: "demand_unmet_1",
      isUnmetDemand: true,
    });

    const { visualSearch } = await import("../../../src/modules/ai/ai.controller");

    const req: any = {
      body: {
        imageUrl: "/uploads/visual-search/custom-rare-shoes.jpg",
      },
    };

    let responseData: any = null;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
        return res;
      }),
    };

    await visualSearch(req, res, () => {});

    expect(responseData).toBeDefined();
    expect(responseData.isUnmetDemand).toBe(true);
    expect(demandMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        isUnmetDemand: true,
        matchedCount: 0,
      })
    );
  });

  it("should aggregate demand insights metrics for sellers", async () => {
    const mockDemands = [
      {
        _id: "dem_1",
        detectedTitle: "Rare Denim Jacket",
        detectedCategory: "Fashion",
        isUnmetDemand: true,
        createdAt: new Date(),
      },
    ];

    const chainableDemandFind = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(mockDemands),
    };

    demandMocks.find.mockReturnValue(chainableDemandFind);
    demandMocks.countDocuments
      .mockResolvedValueOnce(1) // filter total
      .mockResolvedValueOnce(5) // total searches
      .mockResolvedValueOnce(2); // unmet searches

    demandMocks.aggregate
      .mockResolvedValueOnce([{ _id: "Fashion", count: 3 }])
      .mockResolvedValueOnce([{ _id: "jacket", count: 2 }]);

    const { getVisualSearchDemands } = await import("../../../src/modules/ai/ai.controller");

    const req: any = {
      query: { status: "unmet" },
    };

    let responseData: any = null;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
        return res;
      }),
    };

    await getVisualSearchDemands(req, res, () => {});

    expect(responseData).toBeDefined();
    expect(responseData.metrics.totalSearches).toBe(5);
    expect(responseData.metrics.unmetSearches).toBe(2);
    expect(responseData.demands).toHaveLength(1);
  });

  it("should return similar-type products even when user product name doesn't match directly", async () => {
    const mockProducts = [
      {
        _id: "prod_diff_brand",
        title: "BassPro High-Definition Wireless Headphones",
        category: "Electronics",
        price: 4200,
        tags: ["headphones", "wireless", "audio", "bass"],
        images: ["/uploads/basspro.jpg"],
      },
    ];

    const chainableFind = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(mockProducts),
    };

    productMocks.find.mockReturnValue(chainableFind);
    demandMocks.create.mockResolvedValue({ _id: "demand_similar_1", isUnmetDemand: false });

    const { visualSearch } = await import("../../../src/modules/ai/ai.controller");

    const req: any = {
      body: {
        imageUrl: "/uploads/visual-search/sony-wh-1000xm5.jpg",
        searchQuery: "Sony WH-1000XM5 Noise Cancelling", // Different model/brand from store's BassPro
      },
    };

    let responseData: any = null;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
        return res;
      }),
    };

    await visualSearch(req, res, () => {});

    expect(responseData).toBeDefined();
    expect(responseData.success).toBe(true);
    expect(responseData.count).toBe(1);
    expect(responseData.products[0].matchBadge).toBe("Similar Type");
    expect(responseData.products[0].matchScore).toBeGreaterThanOrEqual(25);
  });

  it("should delete a visual search demand record by id", async () => {
    demandMocks.findByIdAndDelete.mockResolvedValue({ _id: "demand_del_123" });

    const { deleteVisualSearchDemand } = await import("../../../src/modules/ai/ai.controller");

    const req: any = {
      params: { id: "demand_del_123" },
    };

    let responseData: any = null;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
        return res;
      }),
    };

    await deleteVisualSearchDemand(req, res, () => {});

    expect(responseData).toBeDefined();
    expect(responseData.success).toBe(true);
    expect(responseData.id).toBe("demand_del_123");
    expect(demandMocks.findByIdAndDelete).toHaveBeenCalledWith("demand_del_123");
  });
});
