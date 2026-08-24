import { Request, Response } from "express";
import { Cart, toCartResponse } from "./cart.model";
import { Product } from "../products/product.model";
import { asyncHandler } from "../../utils/async-handler";
import { ApiError } from "../../utils/api-error";

async function getOrCreateCart(userId: string) {
  let cart = await Cart.findOne({ userId });
  if (!cart) cart = await Cart.create({ userId, items: [] });
  return cart;
}

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
      stock: p?.stock ?? 10,
    };
  });

  const subtotal = Math.round(enrichedItems.reduce((s: number, i: any) => s + i.price * i.quantity, 0) * 100) / 100;

  return {
    items: enrichedItems,
    subtotal,
  };
}

export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const cart = await getOrCreateCart(req.user!.id);
  const response = await buildPopulatedCartResponse(cart);
  res.status(200).json(response);
});

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

export const removeCartItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const cart = await getOrCreateCart(req.user!.id);
  cart.items = cart.items.filter((i) => i.productId !== productId);
  await cart.save();
  const response = await buildPopulatedCartResponse(cart);
  res.status(200).json(response);
});
