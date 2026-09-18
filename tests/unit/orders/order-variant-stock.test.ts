import { describe, it, expect, vi, beforeEach } from "vitest";

const cartMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
}));

const productMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  updateOne: vi.fn(),
  findByIdAndUpdate: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  find: vi.fn(),
}));

const orderMocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

const couponMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
}));

vi.mock("../../../src/modules/cart/cart.model", () => ({
  Cart: cartMocks,
}));

vi.mock("../../../src/modules/products/product.model", () => ({
  Product: productMocks,
}));

vi.mock("../../../src/modules/sellers/store.model", () => ({
  Store: storeMocks,
}));

vi.mock("../../../src/modules/orders/order.model", () => ({
  Order: orderMocks,
}));

vi.mock("../../../src/modules/coupons/coupon.model", () => ({
  Coupon: couponMocks,
  computeDiscount: vi.fn(),
  isFreeShippingCouponApplicable: vi.fn(),
}));

vi.mock("../../../src/modules/security/security.service", () => ({
  flagSuspiciousOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/modules/trust/trust.service", () => ({
  recomputeStoreTrustScore: vi.fn().mockResolvedValue(undefined),
}));

import { createOrder } from "../../../src/modules/orders/order.controller";
import { ApiError } from "../../../src/utils/api-error";

const VALID_STORE_ID = "607f1f77bcf86cd799439020";
const VALID_PRODUCT_ID = "507f1f77bcf86cd799439011";

function createRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as unknown as { status: any; json: any };
}

describe("Order Variant Stock Sync & Validations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMocks.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: VALID_STORE_ID, status: "approved" }]),
    });
  });

  it("decrements both variant stock and top-level stock when variant product is ordered", async () => {
    const saveCart = vi.fn().mockResolvedValue(true);
    cartMocks.findOne.mockResolvedValue({
      userId: "user1",
      items: [{ productId: VALID_PRODUCT_ID, quantity: 2, variantName: "Matte Black" }],
      save: saveCart,
    });

    productMocks.findOne.mockResolvedValue({
      _id: VALID_PRODUCT_ID,
      id: VALID_PRODUCT_ID,
      storeId: VALID_STORE_ID,
      sellerId: "seller1",
      category: "Electronics",
      title: "Mechanical Keyboard",
      stock: 30,
      price: 5000,
      variants: [
        { name: "Matte Black", sku: "KB-BLK", stock: 20, price: 5000 },
        { name: "Arctic White", sku: "KB-WHT", stock: 10, price: 5200 },
      ],
    });

    orderMocks.create.mockResolvedValue({
      id: "order-123",
      toJSON: () => ({ id: "order-123" }),
    });
    productMocks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const req = {
      user: { id: "user1" },
      body: { shippingAddress: "123 St", division: "Dhaka", paymentMethod: "cod" },
    } as any;
    const res = createRes();
    const next = vi.fn();

    await createOrder(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(productMocks.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: VALID_PRODUCT_ID,
      }),
      {
        $inc: {
          "variants.$.stock": -2,
          stock: -2,
          sold: 2,
        },
      }
    );
  });

  it("rejects order if product has variants but cart item has no variantName", async () => {
    cartMocks.findOne.mockResolvedValue({
      userId: "user1",
      items: [{ productId: VALID_PRODUCT_ID, quantity: 1 }],
      save: vi.fn(),
    });

    productMocks.findOne.mockResolvedValue({
      _id: VALID_PRODUCT_ID,
      id: VALID_PRODUCT_ID,
      storeId: VALID_STORE_ID,
      title: "Mechanical Keyboard",
      variants: [{ name: "Matte Black", stock: 10 }],
    });

    const req = {
      user: { id: "user1" },
      body: { shippingAddress: "123 St", division: "Dhaka", paymentMethod: "cod" },
    } as any;
    const res = createRes();
    const next = vi.fn();

    await createOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    const err = next.mock.calls[0][0] as ApiError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain("Please select a variant");
  });

  it("supports case-insensitive variant lookup in order", async () => {
    const saveCart = vi.fn().mockResolvedValue(true);
    cartMocks.findOne.mockResolvedValue({
      userId: "user1",
      items: [{ productId: VALID_PRODUCT_ID, quantity: 1, variantName: "matte black" }],
      save: saveCart,
    });

    productMocks.findOne.mockResolvedValue({
      _id: VALID_PRODUCT_ID,
      id: VALID_PRODUCT_ID,
      storeId: VALID_STORE_ID,
      sellerId: "seller1",
      category: "Electronics",
      title: "Mechanical Keyboard",
      stock: 10,
      variants: [{ name: "Matte Black", stock: 10, price: 5000 }],
    });

    orderMocks.create.mockResolvedValue({
      id: "order-123",
      toJSON: () => ({ id: "order-123" }),
    });
    productMocks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const req = {
      user: { id: "user1" },
      body: { shippingAddress: "123 St", division: "Dhaka", paymentMethod: "cod" },
    } as any;
    const res = createRes();
    const next = vi.fn();

    await createOrder(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(orderMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            variantName: "Matte Black",
          }),
        ],
      })
    );
  });
});
