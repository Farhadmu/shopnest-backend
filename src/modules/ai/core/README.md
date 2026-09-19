# ShopNest — Unified AI Intelligence Core Architecture

This module implements a centralized AI gateway powering all 5 ShopNest AI experiences:
1. **AI Advisor** (`ADVISOR`)
2. **Customer Copilot** (`CUSTOMER_COPILOT`)
3. **Seller Copilot** (`SELLER_COPILOT`)
4. **Admin Copilot / Brain** (`ADMIN_COPILOT`)
5. **Delivery Man Copilot** (`DELIVERY_COPILOT`)

## Architecture Pillars
- **Anti-IDOR & Prompt Security**: Enforces ownership checks across orders, stores, and delivery missions.
- **Ground-Truth Evidence Engine**: Extracts real database records to guarantee grounded answers.
- **Multi-Tier Fallback Gateway**: Gemini -> Groq -> OpenRouter -> Mistral.
- **Cross-Copilot Handoff**: Token-based encrypted envelopes for frictionless handoffs.
- **Auditing & Governance**: Verifiable decision trees and structured action execution models.
