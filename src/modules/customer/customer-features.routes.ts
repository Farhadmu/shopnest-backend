import { Router } from "express";
import * as ctrl from "./ai-features.controller";
import * as productIntelligence from "./features/product-intelligence.controller";
import * as deliveryTracking from "./features/delivery-tracking.controller";
import * as returnsCtrl from "./features/returns.controller";
import * as paymentsCtrl from "./features/payments.controller";
import * as vouchersCtrl from "./features/vouchers.controller";
import * as wishlistTools from "./features/wishlist-tools.controller";
import * as buyAgainCtrl from "./features/buy-again.controller";
import * as purchaseVaultCtrl from "./features/purchase-vault.controller";
import * as messagingCtrl from "./features/messaging.controller";
import * as supportCtrl from "./features/support.controller";
import * as loyaltyCtrl from "./features/loyalty.controller";
import * as addressesCtrl from "./features/addresses.controller";
import * as accountSecurityCtrl from "./features/account-security.controller";
import * as shoppingProfileCtrl from "./features/shopping-profile.controller";
import * as banglaSearchCtrl from "./features/bangla-search.controller";
import * as priceStockAlertsCtrl from "./features/price-stock-alerts.controller";
import * as productQnaCtrl from "./features/product-qna.controller";
import * as dealFeedCtrl from "./features/deal-feed.controller";
import * as compareHistoryCtrl from "./features/compare-history.controller";
import * as productReportsCtrl from "./features/product-reports.controller";
import * as commerceAssistantCtrl from "./features/commerce-assistant.controller";
import * as codRiskCtrl from "./features/cod-risk.controller";
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
router.get("/products/:productId/quality-score", productIntelligence.getProductQualityScore);

// ============================================================
// 7. SELLER TRUST SCORE (Feature 6)
// ============================================================
router.get("/sellers/:storeId/trust-score", productIntelligence.getSellerTrustScore);

// ============================================================
// 8. PERSONAL PRICE INTELLIGENCE (Feature 4)
// ============================================================
router.get("/products/:productId/price-intelligence", productIntelligence.getPriceIntelligence);

// ============================================================
// 9. SMART BANGLADESH DELIVERY (Feature 9)
// ============================================================
router.get("/delivery/estimate", deliveryTracking.getDeliveryEstimate);

// ============================================================
// 10. ADVANCED ORDER TRACKING (Feature 10)
// ============================================================
router.get("/orders/:orderId/tracking", ...requireAuth, deliveryTracking.getAdvancedTracking);

// ============================================================
// 11. SMART RETURN CENTER (Feature 11)
// ============================================================
router.get("/returns", ...requireAuth, returnsCtrl.getReturnRequests);
router.post("/returns", ...requireAuth, returnsCtrl.createReturnRequest);
router.get("/returns/:id", ...requireAuth, returnsCtrl.getReturnDetails);

// ============================================================
// 12. SMART PAYMENT CENTER (Feature 12)
// ============================================================
router.get("/payments", ...requireAuth, paymentsCtrl.getPaymentHistory);
router.get("/payments/summary", ...requireAuth, paymentsCtrl.getPaymentSummary);

// ============================================================
// 13. SMART VOUCHER WALLET (Feature 13)
// ============================================================
router.get("/vouchers", ...requireAuth, vouchersCtrl.getVoucherWallet);
router.post("/vouchers/claim", ...requireAuth, vouchersCtrl.claimVoucher);
router.get("/vouchers/best", ...requireAuth, vouchersCtrl.getBestVoucher);

// ============================================================
// 14. SAVINGS DASHBOARD (Feature 14)
// ============================================================
router.get("/savings", ...requireAuth, vouchersCtrl.getSavingsDashboard);

// ============================================================
// 15. PERSONAL EXPENSE ANALYTICS (Feature 15)
// ============================================================
// Route moved to customer.routes.ts with correct controller

// 16. INTELLIGENT NOTIFICATION CENTER (Feature 16)
// ============================================================
// Routes moved to customer.routes.ts with correct controller

// 17. SMART WISHLIST (Feature 17)
// ============================================================
router.get("/wishlist/smart", ...requireAuth, wishlistTools.getSmartWishlist);
router.post("/wishlist/:productId/track-price", ...requireAuth, wishlistTools.togglePriceTracking);

// ============================================================
// 18. SMART BUY AGAIN (Feature 18)
// ============================================================
router.get("/buy-again", ...requireAuth, buyAgainCtrl.getBuyAgainProducts);

// ============================================================
// 19. DIGITAL PURCHASE VAULT (Feature 22)
// ============================================================
router.get("/purchase-vault", ...requireAuth, purchaseVaultCtrl.getPurchaseVault);
router.get("/purchase-vault/:id", ...requireAuth, purchaseVaultCtrl.getPurchaseDocument);

// ============================================================
// 20. WARRANTY MANAGER (Feature 23)
// ============================================================
router.get("/warranties", ...requireAuth, purchaseVaultCtrl.getWarranties);

// ============================================================
// 21. CUSTOMER-SELLER COMMUNICATION (Feature 24)
// ============================================================
router.get("/messages", ...requireAuth, messagingCtrl.getConversations);
router.get("/messages/:conversationId", ...requireAuth, messagingCtrl.getConversationMessages);
router.post("/messages", ...requireAuth, messagingCtrl.sendMessage);
router.post("/messages/:id/report", ...requireAuth, messagingCtrl.reportMessage);

// ============================================================
// 22. SMART CUSTOMER SUPPORT (Feature 25)
// ============================================================
router.post("/support/ai-chat", ...requireAuth, aiLimiter, supportCtrl.aiSupportChat);
router.get("/support/tickets", ...requireAuth, supportCtrl.getSupportTickets);
router.post("/support/tickets", ...requireAuth, supportCtrl.createSupportTicket);

// ============================================================
// 23. CUSTOMER LOYALTY & REWARDS (Feature 26)
// ============================================================
router.get("/loyalty", ...requireAuth, loyaltyCtrl.getLoyaltyStatus);
router.get("/loyalty/transactions", ...requireAuth, loyaltyCtrl.getLoyaltyTransactions);
router.post("/loyalty/redeem", ...requireAuth, loyaltyCtrl.redeemPoints);

// ============================================================
// 24. ADDRESS INTELLIGENCE (Feature 27)
// ============================================================
router.get("/addresses/intelligent", ...requireAuth, addressesCtrl.getAddressesIntelligent);
router.post("/addresses/intelligent", ...requireAuth, addressesCtrl.createAddressIntelligent);
router.patch("/addresses/intelligent/:id", ...requireAuth, addressesCtrl.updateAddressIntelligent);
router.delete("/addresses/intelligent/:id", ...requireAuth, addressesCtrl.deleteAddressIntelligent);
router.patch("/addresses/intelligent/:id/default", ...requireAuth, addressesCtrl.setDefaultAddressIntelligent);

// ============================================================
// 25. CUSTOMER SECURITY CENTER (Feature 28)
// ============================================================
router.get("/security/center", ...requireAuth, accountSecurityCtrl.getSecurityCenter);
router.get("/security/sessions", ...requireAuth, accountSecurityCtrl.getActiveSessions);
router.delete("/security/sessions/:id", ...requireAuth, accountSecurityCtrl.revokeSession);
router.post("/security/sessions/revoke-all", ...requireAuth, accountSecurityCtrl.revokeAllSessions);
router.post("/security/change-password", ...requireAuth, accountSecurityCtrl.changePassword);

// ============================================================
// 26. ACCOUNT ACTIVITY TIMELINE (Feature 29)
// ============================================================
// Routes moved to customer.routes.ts with correct controller

// 27. PERSONAL SHOPPING PROFILE (Feature 30)
// ============================================================
router.get("/profile/preferences", ...requireAuth, shoppingProfileCtrl.getShoppingProfile);
router.put("/profile/preferences", ...requireAuth, shoppingProfileCtrl.updateShoppingProfile);
router.delete("/profile/preferences", ...requireAuth, shoppingProfileCtrl.resetShoppingProfile);
router.delete("/profile/personalization", ...requireAuth, shoppingProfileCtrl.deletePersonalizationData);

// ============================================================
// 28. 30 ADVANCED CUSTOMER EXTENSION ROUTES
// ============================================================
router.get("/search/bangla", attachUserIfPresent, banglaSearchCtrl.searchBanglaBanglish);
router.get("/cod-risk", ...requireAuth, codRiskCtrl.getCODOrderRisk);
router.get("/products/:productId/trust-report", productIntelligence.getProductTrustReport);
// Courier comparison moved to customer.routes.ts with correct controller
router.get("/orders/:orderId/return-eligibility", ...requireAuth, returnsCtrl.getReturnEligibility);
router.get("/price-alerts", ...requireAuth, priceStockAlertsCtrl.getUserPriceAlerts);
router.post("/price-alerts", ...requireAuth, priceStockAlertsCtrl.subscribePriceAlert);
router.delete("/price-alerts/:id", ...requireAuth, priceStockAlertsCtrl.deletePriceAlert);
router.post("/stock-alerts", ...requireAuth, priceStockAlertsCtrl.subscribeStockAlert);
router.get("/budget-recommendations", productIntelligence.getBudgetShoppingRecommendations);
router.get("/products/:productId/value-score", productIntelligence.getValueForMoneyScore);
router.get("/products/:productId/questions", productQnaCtrl.getProductQuestions);
router.post("/products/:productId/questions", ...requireAuth, productQnaCtrl.askProductQuestion);
router.post("/products/questions/:questionId/answers", ...requireAuth, productQnaCtrl.answerProductQuestion);
router.get("/deals/personalized", attachUserIfPresent, dealFeedCtrl.getPersonalizedDealFeed);
router.get("/compare-history", ...requireAuth, compareHistoryCtrl.getCompareHistory);
router.post("/compare-history", ...requireAuth, compareHistoryCtrl.saveCompareHistory);
router.delete("/compare-history", ...requireAuth, compareHistoryCtrl.clearCompareHistory);
router.get("/wishlist-groups", ...requireAuth, wishlistTools.getWishlistGroups);
router.post("/wishlist-groups", ...requireAuth, wishlistTools.createWishlistGroup);
router.patch("/wishlist-groups/:id", ...requireAuth, wishlistTools.updateWishlistGroup);
router.delete("/wishlist-groups/:id", ...requireAuth, wishlistTools.deleteWishlistGroup);
// Budget/spending analytics routes moved to customer.routes.ts with correct controller
router.post("/delivery-feedback", ...requireAuth, deliveryTracking.submitDeliveryFeedback);
router.get("/delivery-feedback/:orderId", ...requireAuth, deliveryTracking.getDeliveryFeedback);
router.post("/reports", ...requireAuth, productReportsCtrl.submitProductReport);
router.get("/reports", ...requireAuth, productReportsCtrl.getUserProductReports);
router.post("/commerce-assistant", ...requireAuth, aiLimiter, commerceAssistantCtrl.askPersonalCommerceAssistant);

export default router;
