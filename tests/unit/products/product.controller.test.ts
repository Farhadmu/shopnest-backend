import { describe, it, expect, vi, beforeEach } from "vitest";

const productMocks = vi.hoisted(() => ({
  find: vi.fn(),
  findById: vi.fn(),
  findByIdAndUpdate: vi.fn(),
  countDocuments: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  find: vi.fn(),
  findById: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../../../src/modules/products/product.model", () => ({
  Product: productMocks,
}));

vi.mock("../../../src/modules/sellers/store.model", () => ({
  Store: storeMocks,
}));

import { Product } from "../../../src/modules/products/product.model";
import { Store } from "../../../src/modules/sellers/store.model";
import {
  listProducts,
  getProductById,
  getFeaturedProducts,
  updateFeaturedProduct,
  updateProduct,
  clearListCache,
} from "../../../src/modules/products/product.controller";

const VALID_ID = "507f1f77bcf86cd799439011";
const VALID_STORE_ID = "607f1f77bcf86cd799439020";

type AnyFn = ReturnType<typeof vi.fn>;
const mockedProduct = Product as unknown as {
  find: AnyFn;
  findById: AnyFn;
  findByIdAndUpdate: AnyFn;
  countDocuments: AnyFn;
};
const mockedStore = Store as unknown as {
  find: AnyFn;
  findById: AnyFn;
  findOne: AnyFn;
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

function mockProductList(products: unknown[]) {
  const query: Record<string, AnyFn> = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(products),
  };
  mockedProduct.find.mockReturnValue(query);
  mockedProduct.countDocuments.mockResolvedValue(products.length);
  return query;
}

function mockProductFetch(product: unknown | null) {
  const query: Record<string, AnyFn> = {
    lean: vi.fn().mockResolvedValue(product),
  };
  mockedProduct.findById.mockReturnValue(query);
}

function mockStoreFetch(status: string | null) {
  mockedStore.findById.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(
      status === null ? null : { _id: VALID_STORE_ID, status }
    ),
  });
}

function mockStoreResolve(store: unknown) {
  mockedStore.findOne.mockReturnValue({
    lean: vi.fn().mockResolvedValue(store),
    then: (resolve: (v: unknown) => unknown, reject?: (err: unknown) => unknown) =>
      Promise.resolve(store).then(resolve, reject),
  });
}

describe("product.controller store-status exclusion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearListCache();
  });

  describe("listProducts", () => {
    it("adds storeSuspended: false along with active status filter", async () => {
      mockProductList([{ _id: VALID_ID, storeId: "store-1", isDeleted: false, status: "approved", storeSuspended: false }]);

      const req = { query: {} } as never;
      const res = createRes();
      const next = vi.fn();
      await listProducts(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      const passedFilter = mockedProduct.find.mock.calls[0][0] as Record<string, unknown>;
      expect(passedFilter.storeSuspended).toBe(false);
      expect(passedFilter.isDeleted).toBe(false);
      expect(passedFilter.status).toBe("approved");
      expect(mockedProduct.countDocuments).toHaveBeenCalledWith(passedFilter);
    });

    it("resolves a seller identifier into the seller/store $or filter with storeSuspended: false", async () => {
      mockStoreResolve({ _id: VALID_STORE_ID, ownerId: "seller-1" });
      mockProductList([]);

      const req = { query: { seller: "seller-1" } } as never;
      const res = createRes();
      const next = vi.fn();
      await listProducts(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      const passedFilter = mockedProduct.find.mock.calls[0][0] as Record<string, unknown>;
      expect(passedFilter.$or).toEqual([
        { sellerId: "seller-1" },
        { storeId: VALID_STORE_ID },
      ]);
      expect(passedFilter.storeSuspended).toBe(false);
      expect(passedFilter.isDeleted).toBe(false);
      expect(passedFilter.status).toBe("approved");
    });

    it("keeps the approved status filter when a status query is supplied", async () => {
      mockProductList([]);

      const req = { query: { status: "rejected" } } as never;
      const res = createRes();
      const next = vi.fn();
      await listProducts(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      const passedFilter = mockedProduct.find.mock.calls[0][0] as Record<string, unknown>;
      expect(passedFilter.status).toBe("approved");
      expect(passedFilter.storeSuspended).toBe(false);
      expect(passedFilter.$and).toEqual([{ status: "rejected" }]);
    });

    it("preserves specific storeId when requested with storeSuspended: false", async () => {
      mockProductList([]);

      const req = { query: { storeId: VALID_STORE_ID } } as never;
      const res = createRes();
      const next = vi.fn();
      await listProducts(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      const passedFilter = mockedProduct.find.mock.calls[0][0] as Record<string, unknown>;
      expect(passedFilter.storeId).toBe(VALID_STORE_ID);
      expect(passedFilter.storeSuspended).toBe(false);
      expect(passedFilter.isDeleted).toBe(false);
      expect(passedFilter.status).toBe("approved");
    });

    it("handles sort=featured and sorts by isFeatured descending then createdAt descending", async () => {
      const query = mockProductList([]);

      const req = { query: { sort: "featured" } } as never;
      const res = createRes();
      const next = vi.fn();
      await listProducts(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(query.sort).toHaveBeenCalledWith({ isFeatured: -1, createdAt: -1 });
    });

    it("filters by isFeatured when query is true or 1", async () => {
      mockProductList([]);

      const req = { query: { isFeatured: "1" } } as never;
      const res = createRes();
      const next = vi.fn();
      await listProducts(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      const passedFilter = mockedProduct.find.mock.calls[0][0] as Record<string, unknown>;
      expect(passedFilter.isFeatured).toBe(true);
    });
  });

  describe("getProductById", () => {
    it("returns 404 when the product's store is suspended (anonymous user)", async () => {
      mockProductFetch({ _id: VALID_ID, storeId: VALID_STORE_ID, sellerId: "seller-1", title: "P", price: 10, isDeleted: false, status: "approved" });
      mockStoreFetch("suspended");

      const req = { params: { id: VALID_ID }, user: undefined } as never;
      const res = createRes();
      const next = vi.fn();
      await getProductById(req as never, res as never, next as never);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
      expect(res.status).not.toHaveBeenCalled();
    });

    it("returns 404 when the product's store is rejected (anonymous user)", async () => {
      mockProductFetch({ _id: VALID_ID, storeId: VALID_STORE_ID, sellerId: "seller-1", title: "P", price: 10, isDeleted: false, status: "approved" });
      mockStoreFetch("rejected");

      const req = { params: { id: VALID_ID }, user: undefined } as never;
      const res = createRes();
      const next = vi.fn();
      await getProductById(req as never, res as never, next as never);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it("returns 404 when the product's store no longer exists", async () => {
      mockProductFetch({ _id: VALID_ID, storeId: VALID_STORE_ID, sellerId: "seller-1", title: "P", price: 10, isDeleted: false, status: "approved" });
      mockStoreFetch(null);

      const req = { params: { id: VALID_ID }, user: undefined } as never;
      const res = createRes();
      const next = vi.fn();
      await getProductById(req as never, res as never, next as never);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it("returns a hidden product to its own seller", async () => {
      mockProductFetch({ _id: VALID_ID, storeId: VALID_STORE_ID, sellerId: "seller-1", title: "P", price: 10, isDeleted: true, status: "rejected" });
      mockStoreFetch("rejected");

      const req = { params: { id: VALID_ID }, user: { id: "seller-1", role: "seller" } } as never;
      const res = createRes();
      const next = vi.fn();
      await getProductById(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockedStore.findById).not.toHaveBeenCalled();
    });

    it("returns the product to its own seller even when the store is suspended", async () => {
      mockProductFetch({ _id: VALID_ID, storeId: VALID_STORE_ID, sellerId: "seller-1", title: "P", price: 10, isDeleted: false, status: "approved" });
      mockStoreFetch("suspended");

      const req = { params: { id: VALID_ID }, user: { id: "seller-1", role: "seller" } } as never;
      const res = createRes();
      const next = vi.fn();
      await getProductById(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockedStore.findById).not.toHaveBeenCalled();
    });

    it("returns the product to an admin even when the store is rejected", async () => {
      mockProductFetch({ _id: VALID_ID, storeId: VALID_STORE_ID, sellerId: "seller-1", title: "P", price: 10, isDeleted: false, status: "approved" });
      mockStoreFetch("rejected");

      const req = { params: { id: VALID_ID }, user: { id: "admin-1", role: "admin" } } as never;
      const res = createRes();
      const next = vi.fn();
      await getProductById(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockedStore.findById).not.toHaveBeenCalled();
    });

    it("returns 404 when the product is deleted", async () => {
      mockProductFetch({ _id: VALID_ID, storeId: VALID_STORE_ID, sellerId: "seller-1", title: "P", price: 10, isDeleted: true, status: "approved" });
      mockStoreFetch("approved");

      const req = { params: { id: VALID_ID }, user: undefined } as never;
      const res = createRes();
      const next = vi.fn();
      await getProductById(req as never, res as never, next as never);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
      expect(mockedStore.findById).not.toHaveBeenCalled();
    });

    it("returns 404 when the product is rejected", async () => {
      mockProductFetch({ _id: VALID_ID, storeId: VALID_STORE_ID, sellerId: "seller-1", title: "P", price: 10, isDeleted: false, status: "rejected" });
      mockStoreFetch("approved");

      const req = { params: { id: VALID_ID }, user: undefined } as never;
      const res = createRes();
      const next = vi.fn();
      await getProductById(req as never, res as never, next as never);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
      expect(mockedStore.findById).not.toHaveBeenCalled();
    });

    it("returns the product when the store is approved", async () => {
      mockProductFetch({ _id: VALID_ID, storeId: VALID_STORE_ID, sellerId: "seller-1", title: "P", price: 10, isDeleted: false, status: "approved" });
      mockStoreFetch("approved");

      const req = { params: { id: VALID_ID }, user: undefined } as never;
      const res = createRes();
      const next = vi.fn();
      await getProductById(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("getFeaturedProducts", () => {
    it("returns featured products respecting limit and published filters", async () => {
      const mockItems = [
        { _id: VALID_ID, title: "Featured 1", price: 100, isFeatured: true, status: "approved" },
      ];
      mockProductList(mockItems);

      const req = { query: { limit: "4" } } as never;
      const res = createRes();
      const next = vi.fn();

      await getFeaturedProducts(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockedProduct.find).toHaveBeenCalledWith(
        expect.objectContaining({
          isDeleted: false,
          status: "approved",
          storeSuspended: false,
          isFeatured: true,
        })
      );
    });

    it("defaults to limit of exactly 8 and sorts by newest first", async () => {
      const mockItems = Array.from({ length: 8 }, (_, i) => ({
        _id: `${VALID_ID.slice(0, -1)}${i}`,
        title: `Featured ${i + 1}`,
        price: 100,
        isFeatured: true,
        status: "approved",
        createdAt: new Date().toISOString(),
      }));
      const query = mockProductList(mockItems);

      const req = { query: {} } as never;
      const res = createRes();
      const next = vi.fn();

      await getFeaturedProducts(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(query.limit).toHaveBeenCalledWith(8);
    });
  });

  describe("updateFeaturedProduct", () => {
    it("updates isFeatured status successfully", async () => {
      const mockDoc = {
        _id: VALID_ID,
        title: "P",
        isFeatured: false,
        save: vi.fn().mockResolvedValue(undefined),
        toJSON: vi.fn().mockReturnValue({ _id: VALID_ID, title: "P", isFeatured: true }),
      };
      mockedProduct.findById.mockResolvedValue(mockDoc);

      const req = { params: { id: VALID_ID }, body: { isFeatured: true } } as never;
      const res = createRes();
      const next = vi.fn();

      await updateFeaturedProduct(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockDoc.isFeatured).toBe(true);
      expect(mockDoc.save).toHaveBeenCalled();
    });

    it("returns 404 if product not found", async () => {
      mockedProduct.findById.mockResolvedValue(null);

      const req = { params: { id: VALID_ID }, body: { isFeatured: true } } as never;
      const res = createRes();
      const next = vi.fn();

      await updateFeaturedProduct(req as never, res as never, next as never);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });
  });

  describe("updateProduct authorization on isFeatured", () => {
    it("strips isFeatured when a non-admin seller updates a product", async () => {
      const mockDoc = {
        _id: VALID_ID,
        title: "Old Title",
        sellerId: "seller-123",
        isFeatured: false,
        save: vi.fn().mockResolvedValue(undefined),
        toJSON: vi.fn().mockReturnValue({ _id: VALID_ID, title: "New Title", isFeatured: false }),
      };
      mockedProduct.findById.mockResolvedValue(mockDoc);
      mockStoreResolve({ _id: VALID_STORE_ID, sellerId: "seller-123" });

      const req = {
        params: { id: VALID_ID },
        body: { title: "New Title", isFeatured: true },
        user: { id: "seller-123", role: "seller" },
      } as never;
      const res = createRes();
      const next = vi.fn();

      await updateProduct(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(mockDoc.title).toBe("New Title");
      expect(mockDoc.isFeatured).toBe(false); // isFeatured was stripped for non-admin
      expect(mockDoc.save).toHaveBeenCalled();
    });

    it("allows admin to update isFeatured in updateProduct", async () => {
      const mockDoc = {
        _id: VALID_ID,
        title: "Old Title",
        sellerId: "seller-123",
        isFeatured: false,
        save: vi.fn().mockResolvedValue(undefined),
        toJSON: vi.fn().mockReturnValue({ _id: VALID_ID, title: "New Title", isFeatured: true }),
      };
      mockedProduct.findById.mockResolvedValue(mockDoc);

      const req = {
        params: { id: VALID_ID },
        body: { title: "New Title", isFeatured: true },
        user: { id: "admin-1", role: "admin" },
      } as never;
      const res = createRes();
      const next = vi.fn();

      await updateProduct(req as never, res as never, next as never);

      expect(next).not.toHaveBeenCalled();
      expect(mockDoc.isFeatured).toBe(true);
      expect(mockDoc.save).toHaveBeenCalled();
    });
  });
});

