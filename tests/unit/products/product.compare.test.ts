import { describe, it, expect, vi, beforeEach } from "vitest";

const productMocks = vi.hoisted(() => ({
  find: vi.fn(),
  findById: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  find: vi.fn(),
  findById: vi.fn(),
  findOne: vi.fn(),
}));

const reviewMocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  find: vi.fn(),
}));

const courierMocks = vi.hoisted(() => ({
  find: vi.fn(),
}));

const claudeMocks = vi.hoisted(() => ({
  completeJSON: vi.fn(),
  completeJSONWithContext: vi.fn(),
  complete: vi.fn(),
  completeWithContext: vi.fn(),
}));

vi.mock("../../../src/modules/products/product.model", () => ({
  Product: productMocks,
}));

vi.mock("../../../src/modules/sellers/store.model", () => ({
  Store: storeMocks,
}));

vi.mock("../../../src/modules/reviews/review.model", () => ({
  Review: reviewMocks,
}));

vi.mock("../../../src/modules/delivery/courier.model", () => ({
  Courier: courierMocks,
}));

vi.mock("../../../src/modules/ai/providers/claude.provider", () => claudeMocks);

import { getCompareProducts } from "../../../src/modules/products/product.controller";
import { compareProducts } from "../../../src/modules/ai/ai.controller";

const ID_1 = "507f1f77bcf86cd799439011";
const ID_2 = "507f1f77bcf86cd799439022";
const STORE_ID = "607f1f77bcf86cd799439033";

function createRes() {
  const res: Record<string, any> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  return res;
}

describe("Product Comparison Workspace Backend Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCompareProducts controller", () => {
    it("returns empty array if no IDs provided", async () => {
      const req: any = { query: { ids: "" } };
      const res = createRes();

      await getCompareProducts(req, res);
      expect(res.json).toHaveBeenCalledWith([]);
    });

    it("fetches and enriches products with store, review, and delivery data", async () => {
      const mockProducts = [
        {
          _id: ID_1,
          title: "Product One",
          price: 50000,
          discountPrice: 45000,
          category: "Laptops",
          storeId: STORE_ID,
          stock: 10,
          ratingAvg: 4.8,
          ratingCount: 120,
          specifications: { RAM: "16 GB", Storage: "512 GB SSD" },
          freeDelivery: true,
          warrantyMonths: 12,
        },
        {
          _id: ID_2,
          title: "Product Two",
          price: 60000,
          category: "Laptops",
          storeId: STORE_ID,
          stock: 5,
          ratingAvg: 4.5,
          ratingCount: 80,
          specifications: { RAM: "8 GB", Storage: "256 GB SSD" },
          freeDelivery: false,
          warrantyMonths: 24,
        },
      ];

      // buildPublicProductFilter calls Store.find({ status: { $in: ... } }).select('_id')
      storeMocks.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            {
              _id: STORE_ID,
              storeName: "Alpha Tech",
              slug: "alpha-tech",
              rating: 4.9,
              trustScore: 92,
              verifiedAt: new Date(),
            },
          ]),
        }),
      });

      productMocks.find.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockProducts),
      });

      reviewMocks.aggregate.mockResolvedValue([
        {
          _id: ID_1,
          totalCount: 120,
          avgRating: 4.8,
          verifiedCount: 100,
          stars5: 90,
          stars4: 20,
          stars3: 10,
          stars2: 0,
          stars1: 0,
        },
      ]);

      reviewMocks.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue([
                {
                  productId: ID_1,
                  rating: 5,
                  comment: "Excellent build and performance!",
                  userName: "Rahim",
                  verifiedPurchase: true,
                },
              ]),
            }),
          }),
        }),
      });

      courierMocks.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            {
              name: "Pathao Express",
              estimatedDays: "1-2 days",
              rateStructure: [{ price: 60 }],
            },
          ]),
        }),
      });

      const req: any = { query: { ids: `${ID_1},${ID_2}` } };
      const res = createRes();

      await getCompareProducts(req, res);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(Array.isArray(responseData)).toBe(true);
      expect(responseData).toHaveLength(2);
      expect(responseData[0].id).toBe(ID_1);
      expect(responseData[0].store.storeName).toBe("Alpha Tech");
      expect(responseData[0].deliverySummary.freeDelivery).toBe(true);
      expect(responseData[1].deliverySummary.standardFee).toBe(60);
      expect(responseData[0].reviewsSummary.totalReviews).toBe(120);
    });
  });

  describe("compareProducts AI controller", () => {
    it("returns structured comparison with evidence-based verdict and trade-offs", async () => {
      const mockProducts = [
        {
          _id: ID_1,
          title: "Laptop Pro",
          price: 75000,
          ratingAvg: 4.8,
          stock: 10,
          category: "Laptops",
          specifications: { RAM: "16 GB", CPU: "Intel Core i7" },
          freeDelivery: true,
          storeId: STORE_ID,
        },
        {
          _id: ID_2,
          title: "Laptop Air",
          price: 65000,
          ratingAvg: 4.6,
          stock: 15,
          category: "Laptops",
          specifications: { RAM: "8 GB", CPU: "Intel Core i5" },
          freeDelivery: false,
          storeId: STORE_ID,
        },
      ];

      storeMocks.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { _id: STORE_ID, storeName: "Tech Hub", trustScore: 90 },
          ]),
        }),
      });

      productMocks.find.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockProducts),
      });

      claudeMocks.completeJSONWithContext.mockResolvedValue({
        data: {
          summary: "Laptop Pro offers superior performance with 16 GB RAM at ৳75,000, while Laptop Air is ৳10,000 cheaper with standard specifications.",
          verdict: "For intensive programming, Laptop Pro provides better longevity.",
          winnerByValue: ID_2,
          winnerByPriority: {
            criterion: "programming",
            productId: ID_1,
            reason: "Double the RAM and stronger CPU configuration.",
          },
          table: [
            { id: ID_1, prosText: "16 GB RAM, High rating", consText: "Higher price" },
            { id: ID_2, prosText: "Affordable price", consText: "8 GB RAM" },
          ],
          tradeoffs: [
            { productId: ID_1, advantages: ["Higher RAM"], disadvantages: ["Higher price"] },
            { productId: ID_2, advantages: ["Lower price"], disadvantages: ["Lower RAM"] },
          ],
          keyDifferences: [
            { aspect: "Memory", analysis: "16 GB vs 8 GB RAM" },
          ],
        },
        isFallback: false,
        provider: "gemini",
      });

      const req: any = {
        body: {
          productIds: [ID_1, ID_2],
          priority: "programming",
          userPrompt: "Which laptop is best for coding and docker?",
        },
      };
      const res = createRes();

      await compareProducts(req, res);

      expect(res.json).toHaveBeenCalled();
      const aiResponse = res.json.mock.calls[0][0];
      expect(aiResponse).toHaveProperty("summary");
      expect(aiResponse).toHaveProperty("verdict");
      expect(aiResponse.winnerByValue).toBe(ID_2);
      expect(aiResponse.winnerByPriority.criterion).toBe("programming");
      expect(claudeMocks.completeJSONWithContext).toHaveBeenCalled();
    });
  });
});
