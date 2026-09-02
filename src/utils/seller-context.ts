import { Request } from "express";
import { ApiError } from "../utils/api-error";
import { Store } from "../modules/sellers/store.model";

export interface SellerContext {
  sellerId: string;
  storeId: string;
  userId: string;
  storeName: string;
}

/**
 * Derives the authenticated seller's context from the request.
 * 
 * Security rules:
 * - Requires authenticated user (req.user must exist)
 * - Requires seller or admin role
 * - Returns the store owned by the authenticated user
 * - NEVER returns another seller's store
 * - NEVER falls back to demo data
 */
export async function getAuthenticatedSellerContext(req: Request): Promise<SellerContext> {
  if (!req.user) {
    throw ApiError.unauthorized("Authentication required");
  }

  if (req.user.role !== "seller" && req.user.role !== "admin") {
    throw ApiError.forbidden("Requires seller or admin role");
  }

  const userId = req.user.id;

  // Find the store owned by this user
  const store = await Store.findOne({ ownerId: userId });

  if (!store) {
    throw ApiError.notFound("No store found for this seller account. Please register a store first.");
  }

  return {
    sellerId: userId,
    storeId: store._id.toString(),
    userId,
    storeName: store.storeName,
  };
}

/**
 * Derives seller context for admin users viewing a specific seller.
 * Admins can optionally pass a storeId to view that seller's data.
 */
export async function getSellerContextForAdmin(req: Request, targetStoreId?: string): Promise<SellerContext> {
  if (!req.user) {
    throw ApiError.unauthorized("Authentication required");
  }

  if (req.user.role === "admin" && targetStoreId) {
    const store = await Store.findById(targetStoreId);
    if (!store) {
      throw ApiError.notFound("Store not found");
    }
    return {
      sellerId: store.ownerId,
      storeId: store._id.toString(),
      userId: req.user.id,
      storeName: store.storeName,
    };
  }

  return getAuthenticatedSellerContext(req);
}
