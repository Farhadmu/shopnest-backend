import { describe, it, expect, vi, beforeEach } from "vitest";

const cartMocks = vi.hoisted(() => ({
  findOneAndUpdate: vi.fn(),
}));

const productMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  find: vi.fn(),
}));

vi.mock("../../../src/modules/cart/cart.model", async () => {
  const actual = await vi.importActual<any>("../../../src/modules/cart/cart.model");
  return {
    ...actual,
    Cart: cartMocks,
  };
});

vi.mock("../../../src/modules/products/product.model", () => ({
  Product: productMocks,
}));

import { addCartItem, updateCartItem, removeCartItem } from "../../../src/modules/cart/cart.controller";
import { ApiError } from "../../../src/utils/api-error";

const VALID_PRODUCT_ID = "507f1f77bcf86cd799439011";

function createRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as unknown as { status: any; json: any };
}

describe("Cart Variant Matching & Validations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productMocks.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    });
  });

  it("requires variantName when adding a product with variants", async () => {
    productMocks.findOne.mockResolvedValue({
      _id: VALID_PRODUCT_ID,
      title: "Mechanical Keyboard",
      variants: [{ name: "Matte Black", stock: 10, price: 5000 }],
    });

    const req = {
      user: { id: "user1" },
      body: { productId: VALID_PRODUCT_ID, quantity: 1 },
    } as any;
    const res = createRes();
    const next = vi.fn();

    await addCartItem(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    const err = next.mock.calls[0][0] as ApiError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Please select a variant for this product");
  });

  it("matches variant case-insensitively and updates cart item", async () => {
    const mockCart = {
      userId: "user1",
      items: [] as any[],
      save: vi.fn().mockResolvedValue(true),
    };
    cartMocks.findOneAndUpdate.mockResolvedValue(mockCart);

    productMocks.findOne.mockResolvedValue({
      _id: VALID_PRODUCT_ID,
      title: "Mechanical Keyboard",
      price: 5000,
      stock: 10,
      variants: [{ name: "Matte Black", sku: "KB-BLK", stock: 10, price: 5000, color: "#000" }],
    });

    const req = {
      user: { id: "user1" },
      body: { productId: VALID_PRODUCT_ID, quantity: 1, variantName: "matte black" },
    } as any;
    const res = createRes();
    const next = vi.fn();

    await addCartItem(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCart.items).toHaveLength(1);
    expect(mockCart.items[0]).toEqual(
      expect.objectContaining({
        productId: VALID_PRODUCT_ID,
        quantity: 1,
        variantName: "Matte Black",
        variantSku: "KB-BLK",
      })
    );
  });

  it("updates cart item with case-insensitive variant matching", async () => {
    const mockCart = {
      userId: "user1",
      items: [
        {
          productId: VALID_PRODUCT_ID,
          quantity: 1,
          price: 5000,
          variantName: "Matte Black",
          variantSku: "KB-BLK",
        },
      ],
      save: vi.fn().mockResolvedValue(true),
    };
    cartMocks.findOneAndUpdate.mockResolvedValue(mockCart);

    productMocks.findOne.mockResolvedValue({
      _id: VALID_PRODUCT_ID,
      title: "Mechanical Keyboard",
      variants: [{ name: "Matte Black", stock: 10, price: 5000 }],
    });

    const req = {
      user: { id: "user1" },
      params: { productId: VALID_PRODUCT_ID },
      query: { variantName: "matte black" },
      body: { quantity: 3 },
    } as any;
    const res = createRes();
    const next = vi.fn();

    await updateCartItem(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCart.items[0].quantity).toBe(3);
  });

  it("removes cart item with case-insensitive variant matching", async () => {
    const mockCart = {
      userId: "user1",
      items: [
        {
          productId: VALID_PRODUCT_ID,
          quantity: 1,
          price: 5000,
          variantName: "Matte Black",
        },
      ],
      save: vi.fn().mockResolvedValue(true),
    };
    cartMocks.findOneAndUpdate.mockResolvedValue(mockCart);

    const req = {
      user: { id: "user1" },
      params: { productId: VALID_PRODUCT_ID },
      query: { variantName: "MATTE BLACK" },
    } as any;
    const res = createRes();
    const next = vi.fn();

    await removeCartItem(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCart.items).toHaveLength(0);
  });
});
