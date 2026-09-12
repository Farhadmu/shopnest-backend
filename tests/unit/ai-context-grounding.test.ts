import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env";
import { completeWithContext, completeWithTools } from "../../src/modules/ai/providers/gemini.provider";

describe("AI copilot trusted context grounding", () => {
  beforeEach(() => {
    env.GEMINI_API_KEY = "test-gemini-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "grounded answer" }] } }],
        }),
      })
    );
  });

  it.each([
    [
      "customer recent orders",
      { orders: [{ id: "order-123", status: "delivered", totalAmount: 2500 }] },
      '"order-123"',
    ],
    [
      "seller best-selling products",
      { products: [{ id: "product-456", title: "Best Seller", price: 1200, category: "Phones", ratingAvg: 4.8, stock: 3 }], userContext: { topProducts: ["Best Seller"] } },
      '"Best Seller"',
    ],
    [
      "admin marketplace performance",
      { userContext: { sections: [{ title: "Platform Overview", data: { totalRevenue: 125000 } }] } },
      '"totalRevenue":125000',
    ],
  ])("passes %s context to the model input", async (_caseName, context, expectedContextValue) => {
    await completeWithContext(
      [{ role: "user", content: "What does the data show?" }],
      context,
      { system: "Role-specific instructions" }
    );

    const requestBody = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    const systemText = requestBody.systemInstruction.parts[0].text as string;

    expect(systemText).toContain("TRUSTED APPLICATION DATA");
    expect(systemText).toContain(expectedContextValue);
    expect(requestBody.contents[0].parts[0].text).toBe("What does the data show?");
  });

  it("marks a real provider response as non-fallback", async () => {
    const result = await completeWithContext(
      [{ role: "user", content: "What are my recent orders?" }],
      { orders: [{ id: "order-123", status: "delivered", totalAmount: 2500 }] }
    );

    expect(result).toEqual({ content: "grounded answer", isFallback: false });
  });

  it("does not return text when Gemini reports a max-token truncation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: "I would be happy to help, however" }] },
            finishReason: "MAX_TOKENS",
          }],
        }),
      })
    );

    await expect(completeWithContext([{ role: "user", content: "i need a laptop" }])).rejects.toThrow("truncated");
  });

  it("executes structured Gemini tool calls and sends the result back for final reasoning", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "search_products", args: { query: "camera" } } }] } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ content: { role: "model", parts: [{ text: "The supplied camera is a real catalog match." }] } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeWithTools(
      [{ role: "user", content: "I need a camera" }],
      [{ name: "search_products", description: "Search products", parameters: { type: "OBJECT" } }],
      async (name, args) => ({ name, args, products: [{ id: "product-1", title: "Travel Camera" }] }),
      { system: "Use tools", maxTokens: 300 }
    );

    expect(result).toEqual({ content: "The supplied camera is a real catalog match.", isFallback: false });
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.contents.some((content: any) => content.role === "function")).toBe(true);
    expect(secondBody.tools[0].functionDeclarations[0].name).toBe("search_products");
  });
});
