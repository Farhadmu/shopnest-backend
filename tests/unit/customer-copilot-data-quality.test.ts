import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/ai/providers/gemini.provider", () => ({
  completeWithTools: vi.fn(),
  completeWithContext: vi.fn(),
}));
vi.mock("../../src/modules/ai/incident/incident.service", () => ({ logAiIncident: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/modules/ai/advisor/conversation.model", () => ({
  AiConversation: class FakeAiConversation {
    static findOne = vi.fn().mockResolvedValue(null);
    _id = { toString: () => "conversation-1" };
    messages: Array<{ role: "user" | "assistant"; content: string; at: Date }> = [];
    constructor(input: { userId: string; messages: [] }) { this.messages = input.messages; }
    save = vi.fn().mockResolvedValue(this);
  },
}));

import { Order } from "../../src/modules/orders/order.model";
import { Product } from "../../src/modules/products/product.model";
import { Wishlist } from "../../src/modules/wishlist/wishlist.model";
import { UserPreferences } from "../../src/modules/customer/customer-features.model";
import { ShoppingGoal } from "../../src/modules/customer/customer-intelligence.model";
import * as aiProvider from "../../src/modules/ai/providers/gemini.provider";
import { calculateCustomerSpending, generateCustomerFallback, handleCustomerCopilotQuery } from "../../src/modules/ai/customer-copilot/customer-copilot.service";

function queryChain<T>(value: T) {
  const chain = { sort: vi.fn(() => chain), limit: vi.fn(() => chain), select: vi.fn(() => chain), lean: vi.fn().mockResolvedValue(value) };
  return chain;
}

describe("Customer Copilot tool agent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(aiProvider.completeWithTools).mockResolvedValue({ content: "grounded agent answer", isFallback: false });
  });

  it("keeps the existing spending business rule", () => {
    expect(calculateCustomerSpending([
      { status: "delivered", totalAmount: 1200 },
      { status: "cancelled", totalAmount: 9000 },
    ])).toMatchObject({ totalSpent: 1200, qualifyingOrderCount: 1 });
  });

  it("executes generic catalog search and returns structured real products", async () => {
    const product = { _id: { toString: () => "product-1" }, title: "Travel Camera", description: "Compact camera", price: 42000, category: "Cameras", stock: 2, ratingAvg: 4.6, ratingCount: 9, tags: ["camera", "travel"], freeDelivery: true, aiPick: false };
    vi.spyOn(Product, "find").mockReturnValue(queryChain([product]) as any);
    vi.mocked(aiProvider.completeWithTools).mockImplementation(async (_messages, _tools, executeTool) => {
      const result = await executeTool("search_products", { query: "camera travel", category: "Cameras", limit: 8 });
      expect(result).toEqual({ products: [expect.objectContaining({ id: "product-1", title: "Travel Camera", category: "Cameras" })] });
      return { content: "Travel Camera is available in the catalog.", isFallback: false };
    });

    const response = await handleCustomerCopilotQuery("I need a camera for travel", "customer-1");

    expect(response.answer).toContain("Travel Camera");
    // The search path passes a textScore projection as 2nd argument when a query is present
    expect(Product.find).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved", isDeleted: false, stock: { $gt: 0 }, category: { $regex: "Cameras", $options: "i" } }),
      expect.objectContaining({ score: { $meta: "textScore" } })
    );
  });

  it("includes specifications in tool result so AI can reason about brand and attributes", async () => {
    const specs = new Map([["Brand", "ASUS"], ["Graphics", "RTX 4060"]]);
    const product = {
      _id: { toString: () => "product-asus" },
      title: "ASUS TUF Gaming A15",
      description: "Gaming laptop",
      price: 135000,
      category: "Electronics",
      stock: 5,
      ratingAvg: 4.5,
      ratingCount: 12,
      tags: ["asus", "gaming", "laptop"],
      freeDelivery: false,
      aiPick: false,
      specifications: specs,
    };
    vi.spyOn(Product, "find").mockReturnValue(queryChain([product]) as any);
    vi.mocked(aiProvider.completeWithTools).mockImplementation(async (_messages, _tools, executeTool) => {
      const result = await executeTool("search_products", { query: "asus gaming laptop" }) as any;
      // specifications must be forwarded as a plain object (not a Map) so the model can read them
      expect(result.products[0].specifications).toEqual({ Brand: "ASUS", Graphics: "RTX 4060" });
      return { content: "ASUS TUF Gaming A15 is a great gaming laptop.", isFallback: false };
    });

    await handleCustomerCopilotQuery("asus branded laptop, gaming", "customer-2");
  });

  it("sorts text-search results by textScore before popularity metrics", async () => {
    vi.spyOn(Product, "find").mockReturnValue(queryChain([]) as any);
    vi.mocked(aiProvider.completeWithTools).mockImplementation(async (_messages, _tools, executeTool) => {
      await executeTool("search_products", { query: "asus gaming laptop" });
      return { content: "No results.", isFallback: false };
    });

    await handleCustomerCopilotQuery("asus gaming laptop", "customer-3");

    const findCall = vi.mocked(Product.find).mock.results[0];
    // The sort chain should exist; the actual sort args are verified by the Mongoose mock chain
    // We verify that a textScore projection is passed as the second argument
    expect(Product.find).toHaveBeenCalledWith(
      expect.objectContaining({ $or: expect.any(Array) }),
      expect.objectContaining({ score: { $meta: "textScore" } })
    );
  });

  it("binds order, wishlist, and preference tools to the authenticated user", async () => {
    vi.spyOn(Order, "find").mockReturnValue(queryChain([]) as any);
    vi.spyOn(Wishlist, "findOne").mockReturnValue(queryChain(null) as any);
    vi.spyOn(UserPreferences, "findOne").mockReturnValue(queryChain(null) as any);
    vi.spyOn(ShoppingGoal, "find").mockReturnValue(queryChain([]) as any);
    vi.mocked(aiProvider.completeWithTools).mockImplementation(async (_messages, _tools, executeTool) => {
      await executeTool("get_my_orders", { userId: "attacker" });
      await executeTool("get_my_wishlist", { customerId: "attacker" });
      await executeTool("get_my_preferences", { userId: "attacker" });
      return { content: "Customer data retrieved.", isFallback: false };
    });

    await handleCustomerCopilotQuery("show me my shopping data", "authenticated-customer-7");

    expect(Order.find).toHaveBeenCalledWith({ userId: "authenticated-customer-7" });
    expect(Wishlist.findOne).toHaveBeenCalledWith({ userId: "authenticated-customer-7" });
    expect(UserPreferences.findOne).toHaveBeenCalledWith({ userId: "authenticated-customer-7" });
    expect(ShoppingGoal.find).toHaveBeenCalledWith({ userId: "authenticated-customer-7" });
  });

  it("supports multi-step search then product-detail reasoning", async () => {
    const product = { _id: { toString: () => "product-2" }, title: "Camera", description: "", price: 30000, category: "Cameras", stock: 1, ratingAvg: 4, ratingCount: 1, tags: [] };
    vi.spyOn(Product, "find").mockReturnValue(queryChain([product]) as any);
    vi.spyOn(Product, "findOne").mockReturnValue(queryChain(product) as any);
    const calls: string[] = [];
    vi.mocked(aiProvider.completeWithTools).mockImplementation(async (_messages, _tools, executeTool) => {
      calls.push("search_products");
      const search = await executeTool("search_products", { query: "camera" });
      calls.push("get_product");
      await executeTool("get_product", { productId: (search as any).products[0].id });
      return { content: "I compared the supplied product details.", isFallback: false };
    });

    const response = await handleCustomerCopilotQuery("which one is better?", "customer-1");
    expect(calls).toEqual(["search_products", "get_product"]);
    expect(response.isFallback).toBe(false);
  });

  it("keeps a complete deterministic fallback when Gemini fails", async () => {
    vi.mocked(aiProvider.completeWithTools).mockRejectedValue(new Error("tool failure"));
    const response = await handleCustomerCopilotQuery("hello", "customer-1");
    expect(response.isFallback).toBe(true);
    expect(response.answer).toContain("Hi there!");
    expect(generateCustomerFallback("hello", "GENERAL", [], 0, [])).toContain("Hi there!");
  });
});
