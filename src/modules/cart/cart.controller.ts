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

export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const cart = await getOrCreateCart(req.user!.id);
  res.status(200).json(toCartResponse(cart));
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
  res.status(200).json(toCartResponse(cart));
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
  res.status(200).json(toCartResponse(cart));
});

export const removeCartItem = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const cart = await getOrCreateCart(req.user!.id);
  cart.items = cart.items.filter((i) => i.productId !== productId);
  await cart.save();
  res.status(200).json(toCartResponse(cart));
});
