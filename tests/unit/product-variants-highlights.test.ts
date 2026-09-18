import { describe, it, expect, vi, beforeEach } from "vitest";

const productMocks = vi.hoisted(() => ({
  create: vi.fn(),
  findById: vi.fn(),
  find: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
}));

vi.mock("../../src/modules/products/product.model", () => ({
  Product: productMocks,
}));

vi.mock("../../src/modules/sellers/store.model", () => ({
  Store: storeMocks,
}));

import { createProduct, updateProduct } from "../../src/modules/products/product.controller";
import { createProductSchema } from "../../src/schemas/product.schema";

describe("Product Variants, Highlights, PackageContents Persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Zod validation schema", () => {
    it("validates and accepts variants, highlights, and packageContents", () => {
      const validPayload = {
        title: "Mechanical Gaming Keyboard",
        description: "High performance keyboard with custom switches",
        price: 8500,
        category: "Computers & Accessories",
        stock: 50,
        variants: [
          { name: "Matte Black", sku: "KB-BLK", stock: 30, price: 8500, color: "#000000" },
          { name: "Arctic White", sku: "KB-WHT", stock: 20, price: 8700, color: "#ffffff" },
        ],
        highlights: [
          { title: "Hot-swappable PCB", description: "Supports 3-pin and 5-pin switches" },
          { title: "RGB Backlighting", description: "Per-key customizable LEDs" },
        ],
        packageContents: ["1x Keyboard", "1x Keycap Puller", "1x USB-C Braided Cable"],
      };

      const result = createProductSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.variants).toHaveLength(2);
        expect(result.data.highlights).toHaveLength(2);
        expect(result.data.packageContents).toHaveLength(3);
      }
    });

    it("rejects variant without a name", () => {
      const invalidPayload = {
        title: "Test Keyboard",
        description: "Test Description",
        price: 1000,
        category: "Electronics",
        variants: [{ name: "", stock: 10 }],
      };

      const result = createProductSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("rejects highlight without a title", () => {
      const invalidPayload = {
        title: "Test Keyboard",
        description: "Test Description",
        price: 1000,
        category: "Electronics",
        highlights: [{ title: "", description: "No title" }],
      };

      const result = createProductSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });

  describe("Controller persistence", () => {
    it("createProduct saves variants, highlights, and packageContents", async () => {
      storeMocks.findOne.mockResolvedValue({ _id: "store-123" });
      productMocks.create.mockImplementation(async (data) => ({
        ...data,
        toJSON: () => ({ id: "prod-new", ...data }),
      }));

      const req = {
        user: { id: "user-seller-1", role: "seller" },
        body: {
          title: "Premium Wireless Earbuds",
          description: "Active noise cancellation earbuds",
          price: 5000,
          category: "Audio",
          stock: 25,
          variants: [{ name: "Midnight Black", stock: 15 }, { name: "Pearl White", stock: 10 }],
          highlights: [{ title: "ANC 45dB", description: "Deep noise suppression" }],
          packageContents: ["1x Earbuds Pair", "1x Charging Case", "1x USB-C Cable"],
        },
      } as any;

      const jsonMock = vi.fn();
      const res = {
        status: vi.fn().mockReturnValue({ json: jsonMock }),
      } as any;
      const next = vi.fn();

      await createProduct(req, res, next);

      expect(productMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          variants: [{ name: "Midnight Black", stock: 15 }, { name: "Pearl White", stock: 10 }],
          highlights: [{ title: "ANC 45dB", description: "Deep noise suppression" }],
          packageContents: ["1x Earbuds Pair", "1x Charging Case", "1x USB-C Cable"],
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("updateProduct updates variants, highlights, and packageContents", async () => {
      storeMocks.findOne.mockResolvedValue({ _id: "store-123" });
      const mockProduct = {
        _id: "prod-existing",
        sellerId: "user-seller-1",
        title: "Old Earbuds",
        variants: [],
        highlights: [],
        packageContents: [],
        save: vi.fn(),
        toJSON: vi.fn().mockReturnValue({ id: "prod-existing" }),
      };
      productMocks.findById.mockResolvedValue(mockProduct);

      const req = {
        params: { id: "prod-existing" },
        user: { id: "user-seller-1", role: "seller" },
        body: {
          title: "Updated Earbuds",
          variants: [{ name: "Silver Edition", stock: 5 }],
          highlights: [{ title: "Bluetooth 5.4", description: "Ultra-low latency" }],
          packageContents: ["1x Earbuds", "1x Case"],
        },
      } as any;

      const jsonMock = vi.fn();
      const res = {
        status: vi.fn().mockReturnValue({ json: jsonMock }),
      } as any;
      const next = vi.fn();

      await updateProduct(req, res, next);

      expect(mockProduct.save).toHaveBeenCalled();
      expect(mockProduct.variants).toEqual([{ name: "Silver Edition", stock: 5 }]);
      expect(mockProduct.highlights).toEqual([{ title: "Bluetooth 5.4", description: "Ultra-low latency" }]);
      expect(mockProduct.packageContents).toEqual(["1x Earbuds", "1x Case"]);
    });
  });
});
