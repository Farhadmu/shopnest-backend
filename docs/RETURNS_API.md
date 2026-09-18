# ShopNest Backend — Return / Refund / Reverse Delivery

## Customer Endpoints
- `GET /customer/features/orders/:orderId/return-eligibility` — check if an order item is eligible for return
- `POST /customer/features/returns` — create a return request
- `GET /customer/features/returns` — list customer returns
- `GET /customer/features/returns/:id` — get return details
- `PATCH /customer/features/returns/:id/cancel` — cancel a pending return

## Seller Endpoints
- `GET /sellers/returns` — list returns for seller's products
- `GET /sellers/returns/:id` — get return details
- `POST /sellers/returns/:id/approve` — approve a return
- `POST /sellers/returns/:id/reject` — reject a return
- `POST /sellers/returns/:id/receive` — confirm physical receipt of returned product
- `POST /sellers/returns/:id/inspect` — inspect return and trigger refund

## Delivery Man Endpoints
- `GET /customer/features/reverse-delivery/available` — list available reverse deliveries
- `GET /customer/features/reverse-delivery/my` — list my assigned reverse deliveries
- `GET /customer/features/reverse-delivery/:id` — get reverse delivery details
- `POST /customer/features/reverse-delivery/:id/accept` — accept a reverse delivery
- `POST /customer/features/reverse-delivery/:id/start-pickup` — start pickup
- `POST /customer/features/reverse-delivery/:id/otp` — generate pickup OTP
- `POST /customer/features/reverse-delivery/:id/verify-otp` — verify pickup OTP
- `POST /customer/features/reverse-delivery/:id/pickup` — mark as picked up
- `PATCH /customer/features/reverse-delivery/:id/status` — update reverse delivery status
- `PATCH /customer/features/reverse-delivery/:id/location` — update GPS location

## Admin Endpoints
- `GET /customer/features/admin/returns` — list all returns with filters
- `GET /customer/features/admin/returns/:id` — get return details

## State Machine

### ReturnRequest
requested → under_review → approved → reverse_available → reverse_assigned → reverse_accepted → pickup_started → picked_up → in_transit → seller_received → inspection_pending → inspection_approved → refund_pending → refund_processing → refunded

### ReverseDeliveryRequest
available → assigned → accepted → pickup_started → picked_up → in_transit → seller_received

## Inventory
When a seller inspects a return as approved and marks it resalable, the product stock is automatically incremented by the return quantity. Non-resalable returns do not affect stock.

## Refund
- Stripe/card payments: processed via Stripe refund API
- Non-Stripe payments (SSLCommerz, mobile banking, bank transfer, COD): marked as pending with admin notification for manual processing

## Socket.IO Events
- `delivery:location_update` — real-time GPS updates
- `delivery:status_change` — status changes
- `geofence:approaching_pickup` — approaching pickup location
- `geofence:approaching_customer` — approaching destination
