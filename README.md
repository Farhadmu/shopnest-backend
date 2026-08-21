# ShopNest — Backend API

Express + TypeScript + MongoDB backend for **ShopNest**, built to match the
API contract already coded into the frontend's `src/lib/api/*.ts` files —
no frontend changes required to wire it up.

---

## 1. Architecture decision you need to know about

**This backend does not own user identity.** The frontend uses
[`better-auth`](https://www.better-auth.com) with a MongoDB adapter
(`src/lib/auth.ts`), and forwards the browser's session cookie on every
`protectedFetch`/`protectedMutation` call (`src/lib/core/session.ts`).

So instead of re-implementing login/JWT here, this backend:

1. Connects to the **same** MongoDB database as the frontend
   (`MONGODB_URI` must match).
2. On each request, reads the `better-auth.session_token` cookie, verifies
   its HMAC signature with `BETTER_AUTH_SECRET` (must also match the
   frontend's), and looks the session up directly in better-auth's own
   `session`/`user` collections.
3. Attaches `req.user = { id, email, name, role, image }` for downstream
   route handlers.

**Action required on the frontend side:** better-auth's base user schema
has no `role` field. Add this to `src/lib/auth.ts` so seller/admin routes
work end-to-end (until then, every user defaults to `"customer"`):

```ts
betterAuth({
  // ...existing config
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "customer", input: true },
    },
  },
});
```

You'll flip a user to `"seller"` automatically when they call
`POST /sellers/register` (the backend patches it directly in the `user`
collection). Promote a user to `"admin"` manually in the database for now.

### Testing without a live frontend session

In non-production environments you can bypass the cookie check with debug
headers (useful for Postman/Thunder Client, see SRS §48):

```
x-debug-user-id: 64f0...
x-debug-user-role: seller   # customer | seller | admin
x-debug-user-email: you@example.com
x-debug-user-name: Test User
```

---

## 2. Setup

```bash
cp .env.example .env
# Fill in MONGODB_URI (same DB as frontend), BETTER_AUTH_SECRET (same
# secret as frontend), ANTHROPIC_API_KEY (for the /ai/* routes).

npm install
npm run seed   # optional: adds demo categories + products
npm run dev    # http://localhost:5000/api/v1
```

Production:

```bash
npm run build
npm start
```

---

## 3. Project structure

Matches the structure you specified:

```
src/
  config/        env validation (zod) + mongoose connection
  modules/       one folder per domain (see below)
  middlewares/   auth, role, validate, rate-limit, error, not-found
  schemas/       zod request-validation schemas
  utils/         ApiError, response helpers, async handler, logger
  routes/        aggregates every module's router under /api/v1
  app.ts         express app (helmet, cors, json, rate limit, routes)
  server.ts      boots mongo + http server, graceful shutdown
```

| Module | Responsibility |
|---|---|
| `users` | profile (read/update), admin user list/suspend — reads/writes better-auth's `user` collection directly |
| `categories` | CRUD, admin-only writes |
| `products` | catalog, search/filter/sort/paginate, CRUD, nested reviews, admin moderation |
| `sellers` | store registration, public store page, seller dashboard metrics |
| `cart` | per-user cart, stock-checked add/update/remove |
| `wishlist` | per-user saved items |
| `orders` | checkout from cart (coupon-aware), status lifecycle, seller/admin views |
| `reviews` | product reviews with verified-purchase detection, admin moderation |
| `coupons` | percentage/fixed coupons, validation endpoint used at checkout |
| `trust` | explainable 0–100 seller trust score (fulfillment rate, ratings, disputes, account age) |
| `security` | audit log + lightweight rule-based fraud flags on checkout |
| `admin` | dashboard metrics, seller approval workflow, reported reviews |
| `ai` | Anthropic-backed shopping assistant, product-description generator, review sentiment summary, product comparison, pricing suggestions, visual search |

---

## 4. API reference (base path `/api/v1`)

Matches `src/lib/api/*.ts` in the frontend exactly — response bodies are
the raw resource (`Cart`, `Product[]`, `Order`, ...), not wrapped in a
`{data: ...}` envelope, so no frontend changes are needed.

```
GET    /health

GET    /products?search=&category=&storeId=&minPrice=&maxPrice=&sort=&page=&limit=
GET    /products/:id
POST   /products                     (seller/admin)
PUT    /products/:id                 (owner/admin)
DELETE /products/:id                 (owner/admin)
PATCH  /products/:id/moderate        (admin)
GET    /products/:id/reviews
POST   /products/:id/reviews         (auth)

GET    /categories
POST   /categories                   (admin)
PUT    /categories/:id               (admin)
DELETE /categories/:id               (admin)

GET    /cart                         (auth)
POST   /cart/items                   (auth)
PATCH  /cart/items/:productId        (auth)
DELETE /cart/items/:productId        (auth)

GET    /wishlist                     (auth)
POST   /wishlist/items               (auth)
DELETE /wishlist/items/:productId    (auth)

GET    /orders                       (auth) - my orders
POST   /orders                       (auth) - checkout from cart
GET    /orders/:id                   (auth)
GET    /orders/seller/mine           (seller/admin)
GET    /orders/admin/all             (admin)
PATCH  /orders/:id/status            (seller/admin)

POST   /sellers/register             (auth)
GET    /sellers/stores/:storeId
GET    /sellers/me                   (seller/admin)
PATCH  /sellers/me                   (seller/admin)
GET    /sellers/metrics              (seller/admin)

GET    /coupons/validate/:code?subtotal=
GET    /coupons                      (seller/admin)
POST   /coupons                      (seller/admin)
DELETE /coupons/:id                  (seller/admin)

GET    /trust/sellers/:storeId
GET    /trust/me                     (seller/admin)

GET    /users/profile                (auth)
PATCH  /users/profile                (auth)
GET    /users                        (admin)
PATCH  /users/:id/status             (admin)

GET    /admin/dashboard              (admin)
GET    /admin/sellers?status=
PATCH  /admin/sellers/:id/status     (admin)
GET    /admin/reviews/reported       (admin)

GET    /security/logs                (admin)
PATCH  /security/logs/:id/resolve    (admin)

POST   /ai/chat                      (auth)  — AI shopping assistant
POST   /ai/recommend                          — recommendation engine
POST   /ai/product-description       (seller) — AI product content generator
POST   /ai/review-summary                     — sentiment + summary
POST   /ai/compare                            — neutral product comparison
POST   /ai/pricing                   (seller) — AI pricing suggestion
POST   /ai/visual-search                      — image → similar products
```

---

## 5. Notes & honest limitations (per SRS §55 "AI R&D Documentation")

- **Visual search** describes the uploaded image with the vision-capable
  model, then keyword-matches that description against the catalog via
  MongoDB text search. This is a pragmatic MVP, not real image-embedding
  similarity search — good enough to demo, but a production version should
  use a vector index (e.g. embeddings + Atlas Vector Search / a dedicated
  vector DB).
- **AI pricing** only uses internal platform data (current price, stock,
  units sold, rating, category average), per the SRS's explicit note that
  external competitor scraping is out of scope for this stage.
- **Trust score** and **fraud flags** are transparent, rule-based systems
  (not ML), which is intentional — sellers/admins can see exactly why a
  score is what it is.
- All AI failures are logged to `ai/incident` for later review instead of
  failing silently.
- File/image upload is not wired to cloud storage yet — `images`/`logo`/
  `banner` fields accept any URL string; plug in S3/Cloudinary/etc. and
  point the frontend's upload widget at it when ready.

---

## 6. Security

Helmet, CORS restricted to `CORS_ORIGINS`, per-route zod validation,
role-based access control, general + AI-specific rate limiting, Mongo
injection protection via Mongoose schemas, and centralized error handling
that hides stack traces in production. No secrets are hardcoded — everything
comes from `.env` (see `.env.example`), which is gitignored.
