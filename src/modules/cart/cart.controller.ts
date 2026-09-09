import { Request, Response } from "express";
import { Cart, ICart } from "./cart.model";
import { Product } from "../products/product.model";
import { asyncHandler } from "../../utils/async-handler";
import { ApiError } from "../../utils/api-error";

/**
 * Helper: Deduplicates items in a cart so each productId only appears once,
 * merging quantities together if duplicates exist.
 */
async function normalizeCartItems(cart: ICart & { save: () => Promise<unknown> }) {
  const mergedItems = new Map<string, { productId: string; quantity: number; price: number }>();

  for (const item of cart.items) {
    const productId = String(item.productId);
    const existing = mergedItems.get(productId);
    mergedItems.set(
      productId,
      existing
        ? { ...existing, quantity: existing.quantity + item.quantity, price: item.price }
        : { productId, quantity: item.quantity, price: item.price }
    );
  }

  if (mergedItems.size !== cart.items.length) {
    cart.items = Array.from(mergedItems.values());
    await cart.save();
  }
}

/**
 * Helper: Retrieves the user's active cart from MongoDB or creates an empty one.
 */
async function getOrCreateCart(userId: string) {
  const cart = await Cart.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, items: [] } },
    { new: true, upsert: true }
  );
  await normalizeCartItems(cart);
  return cart;
}

/**
 * Helper: Enriches cart items with live product details (title, images, stock, category)
 * and computes the subtotal. Matches the frontend's expected Cart response shape.
 */
async function buildPopulatedCartResponse(cart: any) {
  const productIds = cart.items.map((i: any) => i.productId);
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const productMap = new Map(products.map((p: any) => [String(p._id), p]));

  const enrichedItems = cart.items.map((i: any) => {
    const p = productMap.get(String(i.productId));
    return {
      productId: i.productId,
      quantity: i.quantity,
      price: i.price,
      title: p?.title ?? `Product #${i.productId}`,
      images: p?.images ?? [],
      category: p?.category ?? "General",
      sellerId: p?.sellerId ?? "",
      storeId: p?.storeId ?? "",
      stock: p?.stock ?? 10,
    };
  });

  const subtotal = Math.round(enrichedItems.reduce((s: number, i: any) => s + i.price * i.quantity, 0) * 100) / 100;

  return {
    items: enrichedItems,
    subtotal,
  };
}

/**
 * Controller: Get User's Cart
 *
 * 1. Inputs Extracted:
 *    - req.user.id: ID of the logged-in user
 * 2. Database Operation:
 *    - Cart.findOne({ userId }) (or Cart.create if not yet created)
 *    - Product.find({ _id: { $in: productIds } }) to enrich items with real-time product info
 * 3. Response Sent:
 *    - HTTP 200: { items: [...enrichedItems], subtotal: number }
 */
export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const cart = await getOrCreateCart(req.user!.id);
  const response = await buildPopulatedCartResponse(cart);
  res.status(200).json(response);
});

/**
 * Controller: Add Item to Cart
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Logged-in user ID
 *    - req.body.productId: ID of the product to add
 *    - req.body.quantity: Number of units to add (default >= 1)
 * 2. Database Operation:
 *    - Product.findOne({ _id: productId, isDeleted: false, status: "approved" }) to verify availability & stock
 *    - Cart.findOne / Cart.create, update item quantity, cart.save()
 * 3. Response Sent:
 *    - HTTP 200: { items: [...enrichedItems], subtotal: number }
 */
export const addCartItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId, quantity } = req.body as { productId: string; quantity: number };

  const product = await Product.findOne({ _id: productId, isDeleted: false, status: "approved" });
  if (!product) throw ApiError.notFound("Product not found");
  if (product.stock < quantity) throw ApiError.badRequest("Not enough stock available");

  const cart = await getOrCreateCart(req.user!.id);
  const price = product.discountPrice ?? product.price;
  const existing = cart.items.find((i) => i.productId === productId);

  if (existing) {
    existing.quantity += quantity;
    existing.price = price;
  } else {
    cart.items.push({ productId, quantity, price });
  }

  await cart.save();
  const response = await buildPopulatedCartResponse(cart);
  res.status(200).json(response);
});

/**
 * Controller: Update Cart Item Quantity
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Logged-in user ID
 *    - req.params.productId: Target product ID in cart
 *    - req.body.quantity: New quantity value
 * 2. Database Operation:
 *    - Product.findOne to check stock limit
 *    - Cart.findOne, update quantity in cart.items, cart.save()
 * 3. Response Sent:
 *    - HTTP 200: { items: [...enrichedItems], subtotal: number }
 */
export const updateCartItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const { quantity } = req.body as { quantity: number };

  const product = await Product.findOne({ _id: productId, isDeleted: false });
  if (product && product.stock < quantity) throw ApiError.badRequest("Not enough stock available");

  const cart = await getOrCreateCart(req.user!.id);
  const item = cart.items.find((i) => i.productId === productId);
  if (!item) throw ApiError.notFound("Item not in cart");

  item.quantity = quantity;
  await cart.save();

  const response = await buildPopulatedCartResponse(cart);
  res.status(200).json(response);
});

/**
 * Controller: Remove Item From Cart
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Logged-in user ID
 *    - req.params.productId: Product ID to remove
 * 2. Database Operation:
 *    - Cart.findOne, filter out productId from cart.items, cart.save()
 * 3. Response Sent:
 *    - HTTP 200: { items: [...enrichedItems], subtotal: number }
 */
export const removeCartItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const cart = await getOrCreateCart(req.user!.id);

  cart.items = cart.items.filter((i) => i.productId !== productId);
  await cart.save();

  const response = await buildPopulatedCartResponse(cart);
  res.status(200).json(response);
});
