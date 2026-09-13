import { describe, it, expect, vi, beforeEach } from "vitest";

const cartMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
}));

const productMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
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

import { Cart } from "../../../src/modules/cart/cart.model";
import { Product } from "../../../src/modules/products/product.model";
import { Store } from "../../../src/modules/sellers/store.model";
import { Order } from "../../../src/modules/orders/order.model";
import { createOrder } from "../../../src/modules/orders/order.controller";
import { ApiError } from "../../../src/utils/api-error";

const VALID_STORE_ID = "607f1f77bcf86cd799439020";
const VALID_PRODUCT_ID = "507f1f77bcf86cd799439011";

type AnyFn = ReturnType<typeof vi.fn>;
const mockedCart = Cart as unknown as { findOne: AnyFn };
const mockedProduct = Product as unknown as { findOne: AnyFn; findByIdAndUpdate: AnyFn };
const mockedStore = Store as unknown as { find: AnyFn };
const mockedOrder = Order as unknown as { create: AnyFn };

function createRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as unknown as { status: AnyFn; json: AnyFn };
}

describe("createOrder store status validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ApiError if a product's store is suspended", async () => {
    mockedCart.findOne.mockResolvedValue({
      userId: "user1",
      items: [{ productId: VALID_PRODUCT_ID, quantity: 1 }],
    });

    mockedProduct.findOne.mockResolvedValue({
      _id: VALID_PRODUCT_ID,
      id: VALID_PRODUCT_ID,
      storeId: VALID_STORE_ID,
      sellerId: "seller1",
      category: "Electronics",
      title: "Test Headphones",
      stock: 10,
      price: 100,
    });

    mockedStore.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: VALID_STORE_ID, status: "suspended" },
      ]),
    });

    const req = {
      user: { id: "user1" },
      body: { shippingAddress: "123 St", division: "Dhaka", paymentMethod: "cod" },
    } as never;
    const res = createRes();
    const next = vi.fn();

    await createOrder(req as never, res as never, next as never);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    const err = next.mock.calls[0][0] as ApiError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain("Test Headphones");
    expect(err.message).toContain("store is not approved");
    expect(mockedOrder.create).not.toHaveBeenCalled();
  });

  it("throws ApiError if a product's store is rejected", async () => {
    mockedCart.findOne.mockResolvedValue({
      userId: "user1",
      items: [{ productId: VALID_PRODUCT_ID, quantity: 1 }],
    });

    mockedProduct.findOne.mockResolvedValue({
      _id: VALID_PRODUCT_ID,
      id: VALID_PRODUCT_ID,
      storeId: VALID_STORE_ID,
      sellerId: "seller1",
      category: "Electronics",
      title: "Test Headphones",
      stock: 10,
      price: 100,
    });

    mockedStore.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: VALID_STORE_ID, status: "rejected" },
      ]),
    });

    const req = {
      user: { id: "user1" },
      body: { shippingAddress: "123 St", division: "Dhaka", paymentMethod: "cod" },
    } as never;
    const res = createRes();
    const next = vi.fn();

    await createOrder(req as never, res as never, next as never);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    const err = next.mock.calls[0][0] as ApiError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain("Test Headphones");
    expect(mockedOrder.create).not.toHaveBeenCalled();
  });

  it("allows order creation if store status is approved", async () => {
    const saveCart = vi.fn().mockResolvedValue(true);
    const cartObj = {
      userId: "user1",
      items: [{ productId: VALID_PRODUCT_ID, quantity: 1 }],
      save: saveCart,
    };
    mockedCart.findOne.mockResolvedValue(cartObj);

    mockedProduct.findOne.mockResolvedValue({
      _id: VALID_PRODUCT_ID,
      id: VALID_PRODUCT_ID,
      storeId: VALID_STORE_ID,
      sellerId: "seller1",
      category: "Electronics",
      title: "Test Headphones",
      stock: 10,
      price: 100,
    });

    mockedStore.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: VALID_STORE_ID, status: "approved" },
      ]),
    });

    const mockOrderDoc = {
      id: "order123",
      userId: "user1",
      items: [],
      subtotal: 100,
      totalAmount: 160,
      toJSON: vi.fn().mockReturnValue({ id: "order123" }),
    };
    mockedOrder.create.mockResolvedValue(mockOrderDoc);
    mockedProduct.findByIdAndUpdate.mockResolvedValue(true);

    const req = {
      user: { id: "user1" },
      body: { shippingAddress: "123 St", division: "Dhaka", paymentMethod: "cod" },
    } as never;
    const res = createRes();
    const next = vi.fn();

    await createOrder(req as never, res as never, next as never);

    expect(next).not.toHaveBeenCalled();
    expect(mockedOrder.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
