import { describe, it, expect } from "vitest";
import { parseAdminIntent, normalizeAdminQuery } from "../../../src/modules/admin-ai/admin-ai.intent";

describe("Admin Intelligence & Brain: Multilingual Intent & Agentic OS", () => {
  describe("1. Multilingual Query Normalization (English, Bangla, Banglish)", () => {
    it("normalizes English queries properly", () => {
      expect(normalizeAdminQuery("  Show ALL Pending Sellers!  ")).toBe("show all pending sellers!");
    });

    it("normalizes Banglish phrases with common colloquial transliterations", () => {
      const normalized = normalizeAdminQuery("pending seller gula kothay? shob dekhan");
      expect(normalized).toContain("seller");
      expect(normalized).toContain("pending");
    });

    it("handles native Bengali script (বাংলা)", () => {
      const normalized = normalizeAdminQuery("পেন্ডিং সেলারগুলো দেখাও");
      expect(normalized).toContain("পেন্ডিং");
    });
  });

  describe("2. Intent Parsing: Sellers Management (English, Bangla, Banglish)", () => {
    it("detects English pending seller listing intent", () => {
      const res = parseAdminIntent("Show all pending sellers in the marketplace");
      expect(res.intent).toBe("GET_PENDING_SELLERS");
      expect(res.entities.sellerStatus).toBe("pending");
    });

    it("detects Banglish seller listing intent ('seller gula dekhao', 'pending seller gula koi')", () => {
      const res1 = parseAdminIntent("pending seller gula koi?");
      expect(res1.intent).toBe("GET_PENDING_SELLERS");
      expect(res1.entities.sellerStatus).toBe("pending");

      const res2 = parseAdminIntent("shob seller list dekhao");
      expect(res2.intent).toBe("GET_SELLERS");
    });

    it("detects native Bangla seller listing intent", () => {
      const res = parseAdminIntent("পেন্ডিং সেলারদের তালিকা দেখাও");
      expect(res.intent).toBe("GET_PENDING_SELLERS");
      expect(res.entities.sellerStatus).toBe("pending");
    });

    it("detects seller rejection intent with entity name in Banglish ('Tech World ke reject kore dao')", () => {
      const res = parseAdminIntent("Tech World ke reject kore dao");
      expect(res.intent).toBe("REJECT_SELLER");
      expect(res.entities.sellerName?.toLowerCase()).toContain("tech world");
    });

    it("detects seller approval intent in English and Banglish", () => {
      const res1 = parseAdminIntent("Approve Apex Gadgets store");
      expect(res1.intent).toBe("APPROVE_SELLER");
      expect(res1.entities.sellerName?.toLowerCase()).toContain("apex gadgets");

      const res2 = parseAdminIntent("Apex Store ke approve kore dao");
      expect(res2.intent).toBe("APPROVE_SELLER");
      expect(res2.entities.sellerName?.toLowerCase()).toContain("apex store");
    });
  });

  describe("3. Intent Parsing: Financials, Orders & Delivery Fleet", () => {
    it("detects revenue inquiries in English, Banglish ('ajker revenue koto'), and Bangla ('আজকের আয় কত')", () => {
      expect(parseAdminIntent("What is today's revenue and GMV?").intent).toBe("GET_REVENUE_ANALYTICS");
      expect(parseAdminIntent("ajker revenue koto?").intent).toBe("GET_REVENUE_ANALYTICS");
      expect(parseAdminIntent("আজকের আয় কত?").intent).toBe("GET_REVENUE_ANALYTICS");
    });

    it("detects low-stock / inventory intent in English and Banglish ('low stock product gula ber koro')", () => {
      const res1 = parseAdminIntent("Show low stock products");
      expect(res1.intent).toBe("GET_LOW_STOCK_PRODUCTS");
      expect(res1.entities.isLowStock).toBe(true);

      const res2 = parseAdminIntent("low stock product gula ber koro");
      expect(res2.intent).toBe("GET_LOW_STOCK_PRODUCTS");
      expect(res2.entities.isLowStock).toBe(true);
    });

    it("detects delayed deliveries intent in English and Banglish", () => {
      const res1 = parseAdminIntent("Show delayed or failed deliveries");
      expect(res1.intent).toBe("GET_DELIVERY_FLEET");
      expect(res1.entities.deliveryStatus).toBe("delayed");

      const res2 = parseAdminIntent("delivery fleet kothay delay hocche");
      expect(res2.intent).toBe("GET_DELIVERY_FLEET");
      expect(res2.entities.deliveryStatus).toBe("delayed");
    });

    it("detects order cancellation intent with order ID", () => {
      const res = parseAdminIntent("Cancel order 65f29d38102a983");
      expect(res.intent).toBe("CANCEL_ORDER");
      expect(res.entities.orderId).toBe("65f29d38102a983");
    });
  });

  describe("4. Intent Parsing: Confirmation & Cancellation Safety Workflows", () => {
    it("recognizes affirmative confirmations in English, Banglish, and Bangla", () => {
      expect(parseAdminIntent("yes confirm").intent).toBe("CONFIRM_ACTION");
      expect(parseAdminIntent("yes please proceed").intent).toBe("CONFIRM_ACTION");
      expect(parseAdminIntent("ha confirm koro").intent).toBe("CONFIRM_ACTION");
      expect(parseAdminIntent("হ্যাঁ করো").intent).toBe("CONFIRM_ACTION");
    });

    it("recognizes cancellation requests", () => {
      expect(parseAdminIntent("cancel that action").intent).toBe("CANCEL_ACTION");
      expect(parseAdminIntent("no do not do it").intent).toBe("CANCEL_ACTION");
      expect(parseAdminIntent("dorkar nai cancel koro").intent).toBe("CANCEL_ACTION");
      expect(parseAdminIntent("না বাতিল করো").intent).toBe("CANCEL_ACTION");
    });

    it("recognizes executive briefing request", () => {
      expect(parseAdminIntent("Give me today's briefing").intent).toBe("BRIEFING");
      expect(parseAdminIntent("ajker overview dao").intent).toBe("BRIEFING");
      expect(parseAdminIntent("আজকের ব্রিফিং দাও").intent).toBe("BRIEFING");
    });
  });

  describe("5. Entity Resolution & Ordinal References", () => {
    it("extracts ordinal reference 'the first one' or 'prothom ta'", () => {
      const res1 = parseAdminIntent("Reject the first one");
      expect(res1.intent).toBe("REJECT_SELLER");
      expect(res1.entities.ordinalReference).toBe("first");

      const res2 = parseAdminIntent("prothom ta approve koro");
      expect(res2.intent).toBe("APPROVE_SELLER");
      expect(res2.entities.ordinalReference).toBe("first");

      const res3 = parseAdminIntent("second store ta reject koro");
      expect(res3.intent).toBe("REJECT_SELLER");
      expect(res3.entities.ordinalReference).toBe("second");
    });
  });
});
