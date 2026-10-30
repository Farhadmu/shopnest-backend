import { describe, it, expect, vi, beforeEach } from "vitest";

const productMocks = vi.hoisted(() => ({
  find: vi.fn(),
  countDocuments: vi.fn(),
}));

const demandMocks = vi.hoisted(() => ({
  create: vi.fn(),
  find: vi.fn(),
  findById: vi.fn(),
  countDocuments: vi.fn(),
  aggregate: vi.fn(),
  findByIdAndUpdate: vi.fn(),
  findByIdAndDelete: vi.fn(),
}));

const historyMocks = vi.hoisted(() => ({
  create: vi.fn(),
  find: vi.fn(),
  deleteMany: vi.fn(),
}));

const conversationMocks = vi.hoisted(() => ({
  create: vi.fn(),
  findOne: vi.fn(),
  findById: vi.fn(),
}));

vi.mock("../../../src/modules/products/product.model", () => ({
  Product: productMocks,
}));

vi.mock("../../../src/modules/ai/visual-search-demand.model", () => ({
  VisualSearchDemand: demandMocks,
}));

vi.mock("../../../src/modules/ai/visual-search-history.model", () => ({
  VisualSearchHistory: historyMocks,
}));

vi.mock("../../../src/modules/ai/advisor/conversation.model", () => ({
  AiConversation: conversationMocks,
  sanitizeAiConversationMessages: vi.fn((m) => m),
}));

vi.mock("../../../src/utils/activeProductFilter", () => ({
  buildPublicProductFilter: vi.fn().mockResolvedValue({ isDeleted: false }),
  getPublicProduct: vi.fn(),
}));

describe("ShopNest AI Visual Search 2.0 & Demand Intelligence Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. should record visual search demand and return hybrid ranked matching products", async () => {
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
        stock: 10,
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
    historyMocks.create.mockResolvedValue({ _id: "hist_123" });

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
    expect(responseData.products[0].matchScore).toBeGreaterThanOrEqual(40);
    expect(responseData.products[0].matchBadge).toBeDefined();
    expect(demandMocks.create).toHaveBeenCalledTimes(1);
    expect(historyMocks.create).toHaveBeenCalledTimes(1);
  }, 15000);

  it("2. should mark isUnmetDemand as true when 0 catalog matches are found (never show fake items)", async () => {
    const chainableEmptyFind = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
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
    expect(responseData.count).toBe(0);
    expect(responseData.products).toEqual([]);
    expect(demandMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        isUnmetDemand: true,
        matchedCount: 0,
      })
    );
  });

  it("3. should support guest visual search without throwing or requiring authentication", async () => {
    const chainableFind = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          _id: "prod_guest_1",
          title: "Sports Running Shoes",
          category: "Fashion",
          price: 2500,
          tags: ["shoes", "running"],
          images: ["/uploads/shoes.jpg"],
        },
      ]),
    };

    productMocks.find.mockReturnValue(chainableFind);
    demandMocks.create.mockResolvedValue({ _id: "demand_guest_1" });

    const { visualSearch } = await import("../../../src/modules/ai/ai.controller");

    const req: any = {
      body: {
        imageUrl: "/uploads/visual-search/running-shoes.jpg",
      },
      // guest: no user object
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
    expect(demandMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userRole: "guest",
        userId: null,
      })
    );
    expect(historyMocks.create).not.toHaveBeenCalled();
  });

  it("4. should aggregate demand insights metrics and period filtering for sellers", async () => {
    const mockDemands = [
      {
        _id: "dem_1",
        detectedTitle: "Rare Denim Jacket",
        detectedCategory: "Fashion",
        isUnmetDemand: true,
        imageUrl: "/uploads/visual-search/denim.jpg",
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
      .mockResolvedValueOnce(10) // total searches
      .mockResolvedValueOnce(4); // unmet searches

    demandMocks.aggregate
      .mockResolvedValueOnce([{ _id: "Fashion", count: 6 }]) // categoryAgg
      .mockResolvedValueOnce([{ _id: "jacket", count: 4 }]) // tagAgg
      .mockResolvedValueOnce([{ _id: "blue", count: 5 }]) // colorAgg
      .mockResolvedValueOnce([{ _id: "Denim Jacket", count: 4 }]); // productTypeAgg

    const { getVisualSearchDemands } = await import("../../../src/modules/ai/ai.controller");

    const req: any = {
      query: { status: "unmet", period: "7d" },
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
    expect(responseData.metrics.totalSearches).toBe(10);
    expect(responseData.metrics.unmetSearches).toBe(4);
    expect(responseData.metrics.matchedSearches).toBe(6);
    expect(responseData.metrics.popularColors).toBeDefined();
    expect(responseData.metrics.trendingProductTypes).toBeDefined();
    expect(responseData.demands).toHaveLength(1);
  });

  it("5. should return similar style badge when user searches different model of same product type", async () => {
    const mockProducts = [
      {
        _id: "prod_diff_brand",
        title: "BassPro High-Definition Wireless Headphones",
        category: "Electronics",
        price: 4200,
        tags: ["headphones", "wireless", "audio", "bass"],
        images: ["/uploads/basspro.jpg"],
        stock: 5,
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
        searchQuery: "Sony WH-1000XM5 Noise Cancelling",
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
    expect(["Similar Style", "Direct Match", "Alternative"]).toContain(
      responseData.products[0].matchBadge
    );
    expect(responseData.products[0].matchScore).toBeGreaterThanOrEqual(20);
  });

  it("6. should reject deletion of customer demand records with 403 forbidden", async () => {
    const { deleteVisualSearchDemand } = await import("../../../src/modules/ai/ai.controller");

    const req: any = {
      params: { id: "demand_del_123" },
    };

    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    let caughtError: any = null;
    const next = (err: any) => {
      caughtError = err;
    };

    await deleteVisualSearchDemand(req, res, next);

    expect(caughtError).toBeDefined();
    expect(caughtError.statusCode).toBe(403);
    expect(demandMocks.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it("7. should support retrieving and clearing visual search history for authenticated users", async () => {
    const { getVisualSearchHistory, clearVisualSearchHistory } = await import(
      "../../../src/modules/ai/ai.controller"
    );

    const mockHistory = [
      {
        _id: "hist_1",
        userId: "cust_1",
        imageUrl: "/uploads/visual-search/sample.jpg",
        detectedTitle: "Running Shoes",
        detectedCategory: "Fashion",
      },
    ];

    const chainableHistFind = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(mockHistory),
    };
    historyMocks.find.mockReturnValue(chainableHistFind);
    historyMocks.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const reqGet: any = { user: { id: "cust_1" } };
    let getResult: any = null;
    const resGet: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        getResult = data;
        return resGet;
      }),
    };

    await getVisualSearchHistory(reqGet, resGet, () => {});
    expect(Array.isArray(getResult)).toBe(true);
    expect(getResult).toHaveLength(1);

    const reqClear: any = { user: { id: "cust_1" } };
    let clearResult: any = null;
    const resClear: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        clearResult = data;
        return resClear;
      }),
    };

    await clearVisualSearchHistory(reqClear, resClear, () => {});
    expect(clearResult.success).toBe(true);
    expect(historyMocks.deleteMany).toHaveBeenCalledWith({ userId: "cust_1" });
  });

  it("8. should block private network and SSRF targets in remote image validation", async () => {
    const { isSafeRemoteUrl } = await import(
      "../../../src/modules/ai/image-validation.service"
    );

    expect(isSafeRemoteUrl("http://localhost:3000/avatar.jpg").isSafe).toBe(false);
    expect(isSafeRemoteUrl("http://127.0.0.1:8080/exploit.jpg").isSafe).toBe(false);
    expect(isSafeRemoteUrl("http://169.254.169.254/latest/meta-data/").isSafe).toBe(false);
    expect(isSafeRemoteUrl("http://10.0.0.5/private.png").isSafe).toBe(false);
    expect(isSafeRemoteUrl("http://192.168.1.1/router.png").isSafe).toBe(false);
    expect(isSafeRemoteUrl("https://images.unsplash.com/photo-1542291026-7eec264c27ff").isSafe).toBe(true);
  });

  it("9. should validate image magic bytes strictly", async () => {
    const { checkMagicBytes, validateImageBuffer } = await import(
      "../../../src/modules/ai/image-validation.service"
    );

    // Fake JPEG header: FF D8 FF
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(checkMagicBytes(jpegBuffer)).toBe("image/jpeg");

    // Executable/PHP buffer
    const badBuffer = Buffer.from("<?php echo 'malicious'; ?>");
    expect(checkMagicBytes(badBuffer)).toBeNull();

    // Empty buffer
    const emptyResult = await validateImageBuffer(Buffer.alloc(0));
    expect(emptyResult.isValid).toBe(false);
  });

  it(
    "10. should seed AI Advisor context with visual search results for comparative follow-up questions",
    async () => {
    const { conversationalChat } = await import(
      "../../../src/modules/ai/advisor/conversational-advisor.controller"
    );

    const mockVisualProducts = [
      {
        id: "prod_earbuds_1",
        title: "SoundPEATS True Wireless Earbuds",
        price: 3200,
        discountPrice: 2800,
        category: "Electronics",
        ratingAvg: 4.6,
        storeName: "AudioHub",
        stock: 12,
        matchBadge: "Direct Match",
      },
      {
        id: "prod_earbuds_2",
        title: "Anker Soundcore Life P2",
        price: 4500,
        category: "Electronics",
        ratingAvg: 4.8,
        storeName: "Anker Official",
        stock: 5,
        matchBadge: "Similar Style",
      },
    ];

    conversationMocks.create.mockResolvedValue({
      _id: "conv_visual_1",
      turnCount: 0,
      messages: [],
      conversationState: null,
      save: vi.fn(),
    });

    const req: any = {
      body: {
        message: "Which one is cheaper?",
        visualSearchContext: {
          category: "Electronics",
          products: mockVisualProducts,
        },
      },
    };

    let chatResponse: any = null;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        chatResponse = data;
        return res;
      }),
    };

    await conversationalChat(req, res, () => {});

    expect(chatResponse).toBeDefined();
    expect(chatResponse.success).toBe(true);
    expect(chatResponse.products).toHaveLength(2);
    // Verified Grounding: reply or products reflect SoundPEATS being the cheaper item (৳2,800 vs ৳4,500)
    expect(chatResponse.products[0].price).toBe(2800);
  }, 25000);
});
