import { Router } from "express";
import * as ctrl from "./ai-features.controller";
import * as featuresCtrl from "./customer-features.controller";
import { attachUserIfPresent, requireAuth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { aiLimiter } from "../../middlewares/rate-limit.middleware";
import {
  advancedSearchSchema,
  giftFinderSchema,
  reviewDraftSchema,
  dealFinderSchema,
} from "../../schemas/customer-features.schema";

const router = Router();

// ============================================================
// 1. ADVANCED AI SEARCH (Feature 1)
// ============================================================
router.get("/search", attachUserIfPresent, validate({ query: advancedSearchSchema }), ctrl.advancedSearch);
router.get("/search/suggestions", attachUserIfPresent, ctrl.getSearchSuggestions);
router.get("/search/history", ...requireAuth, ctrl.getSearchHistory);
router.delete("/search/history", ...requireAuth, ctrl.clearSearchHistory);

// ============================================================
// 2. PERSONAL AI SHOPPING AGENT (Feature 2)
// ============================================================
router.post("/shopping-agent", attachUserIfPresent, aiLimiter, ctrl.shoppingAgentChat);

// ============================================================
// 3. AI GIFT FINDER (Feature 19)
// ============================================================
router.post("/gift-finder", attachUserIfPresent, aiLimiter, validate({ body: giftFinderSchema }), ctrl.giftFinder);

// ============================================================
// 4. AI REVIEW ASSISTANT (Feature 20)
// ============================================================
router.post("/review-draft", ...requireAuth, aiLimiter, validate({ body: reviewDraftSchema }), ctrl.generateReviewDraft);

// ============================================================
// 5. SMART DEAL FINDER (Feature 5)
// ============================================================
router.post("/deal-finder", attachUserIfPresent, validate({ body: dealFinderSchema }), ctrl.smartDealFinder);

// ============================================================
// 6. PRODUCT QUALITY SCORE (Feature 7)
// ============================================================
router.get("/products/:productId/quality-score", featuresCtrl.getProductQualityScore);

// ============================================================
// 7. SELLER TRUST SCORE (Feature 6)
// ============================================================
router.get("/sellers/:storeId/trust-score", featuresCtrl.getSellerTrustScore);

// ============================================================
// 8. PERSONAL PRICE INTELLIGENCE (Feature 4)
// ============================================================
router.get("/products/:productId/price-intelligence", featuresCtrl.getPriceIntelligence);

// ============================================================
// 9. SMART BANGLADESH DELIVERY (Feature 9)
// ============================================================
router.get("/delivery/estimate", featuresCtrl.getDeliveryEstimate);

// ============================================================
// 10. ADVANCED ORDER TRACKING (Feature 10)
// ============================================================
router.get("/orders/:orderId/tracking", ...requireAuth, featuresCtrl.getAdvancedTracking);

// ============================================================
// 11. SMART RETURN CENTER (Feature 11)
// ============================================================
router.get("/returns", ...requireAuth, featuresCtrl.getReturnRequests);
router.post("/returns", ...requireAuth, featuresCtrl.createReturnRequest);
router.get("/returns/:id", ...requireAuth, featuresCtrl.getReturnDetails);

// ============================================================
// 12. SMART PAYMENT CENTER (Feature 12)
// ============================================================
router.get("/payments", ...requireAuth, featuresCtrl.getPaymentHistory);
router.get("/payments/summary", ...requireAuth, featuresCtrl.getPaymentSummary);

// ============================================================
// 13. SMART VOUCHER WALLET (Feature 13)
// ============================================================
router.get("/vouchers", ...requireAuth, featuresCtrl.getVoucherWallet);
router.post("/vouchers/claim", ...requireAuth, featuresCtrl.claimVoucher);
router.get("/vouchers/best", ...requireAuth, featuresCtrl.getBestVoucher);

// ============================================================
// 14. SAVINGS DASHBOARD (Feature 14)
// ============================================================
router.get("/savings", ...requireAuth, featuresCtrl.getSavingsDashboard);

// ============================================================
// 15. PERSONAL EXPENSE ANALYTICS (Feature 15)
// ============================================================
router.get("/expense-analytics", ...requireAuth, featuresCtrl.getExpenseAnalytics);

// ============================================================
// 16. INTELLIGENT NOTIFICATION CENTER (Feature 16)
// ============================================================
router.get("/notifications/intelligent", ...requireAuth, featuresCtrl.getIntelligentNotifications);
router.patch("/notifications/:id/read", ...requireAuth, featuresCtrl.markNotificationRead);
router.patch("/notifications/read-all", ...requireAuth, featuresCtrl.markAllNotificationsRead);

// ============================================================
// 17. SMART WISHLIST (Feature 17)
// ============================================================
router.get("/wishlist/smart", ...requireAuth, featuresCtrl.getSmartWishlist);
router.post("/wishlist/:productId/track-price", ...requireAuth, featuresCtrl.togglePriceTracking);

// ============================================================
// 18. SMART BUY AGAIN (Feature 18)
// ============================================================
router.get("/buy-again", ...requireAuth, featuresCtrl.getBuyAgainProducts);

// ============================================================
// 19. DIGITAL PURCHASE VAULT (Feature 22)
// ============================================================
router.get("/purchase-vault", ...requireAuth, featuresCtrl.getPurchaseVault);
router.get("/purchase-vault/:id", ...requireAuth, featuresCtrl.getPurchaseDocument);

// ============================================================
// 20. WARRANTY MANAGER (Feature 23)
// ============================================================
router.get("/warranties", ...requireAuth, featuresCtrl.getWarranties);

// ============================================================
// 21. CUSTOMER-SELLER COMMUNICATION (Feature 24)
// ============================================================
router.get("/messages", ...requireAuth, featuresCtrl.getConversations);
router.get("/messages/:conversationId", ...requireAuth, featuresCtrl.getConversationMessages);
router.post("/messages", ...requireAuth, featuresCtrl.sendMessage);
router.post("/messages/:id/report", ...requireAuth, featuresCtrl.reportMessage);

// ============================================================
// 22. SMART CUSTOMER SUPPORT (Feature 25)
// ============================================================
router.post("/support/ai-chat", ...requireAuth, aiLimiter, featuresCtrl.aiSupportChat);
router.get("/support/tickets", ...requireAuth, featuresCtrl.getSupportTickets);
router.post("/support/tickets", ...requireAuth, featuresCtrl.createSupportTicket);

// ============================================================
// 23. CUSTOMER LOYALTY & REWARDS (Feature 26)
// ============================================================
router.get("/loyalty", ...requireAuth, featuresCtrl.getLoyaltyStatus);
router.get("/loyalty/transactions", ...requireAuth, featuresCtrl.getLoyaltyTransactions);
router.post("/loyalty/redeem", ...requireAuth, featuresCtrl.redeemPoints);

// ============================================================
// 24. ADDRESS INTELLIGENCE (Feature 27)
// ============================================================
router.get("/addresses/intelligent", ...requireAuth, featuresCtrl.getAddressesIntelligent);
router.post("/addresses/intelligent", ...requireAuth, featuresCtrl.createAddressIntelligent);
router.patch("/addresses/intelligent/:id", ...requireAuth, featuresCtrl.updateAddressIntelligent);
router.delete("/addresses/intelligent/:id", ...requireAuth, featuresCtrl.deleteAddressIntelligent);
router.patch("/addresses/intelligent/:id/default", ...requireAuth, featuresCtrl.setDefaultAddressIntelligent);

// ============================================================
// 25. CUSTOMER SECURITY CENTER (Feature 28)
// ============================================================
router.get("/security/center", ...requireAuth, featuresCtrl.getSecurityCenter);
router.get("/security/sessions", ...requireAuth, featuresCtrl.getActiveSessions);
router.delete("/security/sessions/:id", ...requireAuth, featuresCtrl.revokeSession);
router.post("/security/sessions/revoke-all", ...requireAuth, featuresCtrl.revokeAllSessions);
router.post("/security/change-password", ...requireAuth, featuresCtrl.changePassword);

// ============================================================
// 26. ACCOUNT ACTIVITY TIMELINE (Feature 29)
// ============================================================
router.get("/activity", ...requireAuth, featuresCtrl.getActivityTimeline);
router.delete("/activity", ...requireAuth, featuresCtrl.clearActivityTimeline);

// ============================================================
// 27. PERSONAL SHOPPING PROFILE (Feature 30)
// ============================================================
router.get("/profile/preferences", ...requireAuth, featuresCtrl.getShoppingProfile);
router.put("/profile/preferences", ...requireAuth, featuresCtrl.updateShoppingProfile);
router.delete("/profile/preferences", ...requireAuth, featuresCtrl.resetShoppingProfile);
router.delete("/profile/personalization", ...requireAuth, featuresCtrl.deletePersonalizationData);

export default router;
