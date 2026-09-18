import { describe, it, expect, vi, beforeEach } from "vitest";

const productMocks = vi.hoisted(() => ({
  find: vi.fn(),
  findById: vi.fn(),
}));

const categoryMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  findById: vi.fn(),
  find: vi.fn(),
}));

vi.mock("../../../src/modules/products/product.model", () => ({
  Product: productMocks,
}));

vi.mock("../../../src/modules/categories/category.model", () => ({
  Category: categoryMocks,
}));

import { Product } from "../../../src/modules/products/product.model";
import { Category } from "../../../src/modules/categories/category.model";
import { getRecommendedProducts } from "../../../src/modules/products/product.controller";

const VALID_ID = "507f1f77bcf86cd799439011";
const SIBLING_ID = "507f1f77bcf86cd799439012";
const PARENT_CAT_ID = "507f1f77bcf86cd799439099";

type AnyFn = ReturnType<typeof vi.fn>;
const mockedProduct = Product as unknown as {
  find: AnyFn;
  findById: AnyFn;
};
const mockedCategory = Category as unknown as {
  findOne: AnyFn;
  findById: AnyFn;
  find: AnyFn;
};

function createRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  return res as unknown as {
    status: AnyFn;
    json: AnyFn;
    set: AnyFn;
  };
}

describe("getRecommendedProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns products from the same category when they exist", async () => {
    // Current product
    mockedProduct.findById.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: VALID_ID,
        category: "Smartphones",
        status: "approved",
        isDeleted: false,
        storeSuspended: false,
      }),
    });

    const sameCategoryProduct = {
      _id: SIBLING_ID,
      title: "Another Smartphone",
      category: "Smartphones",
      price: 600,
    };

    // Find products in same category
    mockedProduct.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([sameCategoryProduct]),
    });

    const req = {
      params: { id: VALID_ID },
      query: { limit: "8" },
    } as never;
    const res = createRes();

    await getRecommendedProducts(req, res as never, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.success).toBe(true);
    expect(jsonCall.source).toBe("same_category");
    expect(jsonCall.products).toHaveLength(1);
    expect(jsonCall.products[0].title).toBe("Another Smartphone");
  });

  it("falls back to parent category products when same category has no other products", async () => {
    // Current product
    mockedProduct.findById.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: VALID_ID,
        category: "Smartphones",
        status: "approved",
        isDeleted: false,
        storeSuspended: false,
      }),
    });

    const parentProduct = {
      _id: SIBLING_ID,
      title: "Electronics Item",
      category: "Electronics",
      price: 1200,
    };

    // 1st find (same category): empty
    // 2nd find (parent category): returns parentProduct
    mockedProduct.find
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([]),
      })
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([parentProduct]),
      });

    // Category doc for "Smartphones" has parent
    mockedCategory.findOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: "cat-smartphones-id",
        name: "Smartphones",
        parent: PARENT_CAT_ID,
      }),
    });

    // Parent category doc "Electronics"
    mockedCategory.findById.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: PARENT_CAT_ID,
        name: "Electronics",
      }),
    });

    // For resolveCategoryNames
    mockedCategory.find.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        { _id: PARENT_CAT_ID, name: "Electronics", parent: null },
        { _id: "cat-smartphones-id", name: "Smartphones", parent: PARENT_CAT_ID },
      ]),
    });

    const req = {
      params: { id: VALID_ID },
      query: { limit: "8" },
    } as never;
    const res = createRes();

    await getRecommendedProducts(req, res as never, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.success).toBe(true);
    expect(jsonCall.source).toBe("parent_category");
    expect(jsonCall.parentCategory).toBe("Electronics");
    expect(jsonCall.products).toHaveLength(1);
    expect(jsonCall.products[0].title).toBe("Electronics Item");
  });

  it("falls back to general active products if neither same nor parent category has products", async () => {
    mockedProduct.findById.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: VALID_ID,
        category: "UniqueCategory",
        status: "approved",
        isDeleted: false,
        storeSuspended: false,
      }),
    });

    const fallbackProduct = {
      _id: SIBLING_ID,
      title: "Popular Featured Item",
      category: "General",
      price: 350,
    };

    // 1st find (same category): empty
    // 2nd find (fallback): returns fallbackProduct
    mockedProduct.find
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([]),
      })
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([fallbackProduct]),
      });

    // Category has no parent
    mockedCategory.findOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: "cat-unique-id",
        name: "UniqueCategory",
        parent: null,
      }),
    });

    const req = {
      params: { id: VALID_ID },
      query: { limit: "8" },
    } as never;
    const res = createRes();

    await getRecommendedProducts(req, res as never, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.success).toBe(true);
    expect(jsonCall.source).toBe("fallback");
    expect(jsonCall.products).toHaveLength(1);
  });
});
