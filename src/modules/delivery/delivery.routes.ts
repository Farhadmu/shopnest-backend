import { Router } from "express";
import * as ctrl from "./delivery.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { deliveryDocumentUpload, deliveryProofUpload } from "../../middlewares/upload.middleware";
import {
  createOrUpdateProfileSchema,
  setAvailabilitySchema,
  updateLocationSchema,
  updateDeliveryStatusSchema,
  updateReverseDeliveryStatusSchema,
  verifyOtpSchema,
  reportIncidentSchema,
  createIncidentSchema,
  rateDeliverySchema,
} from "../../schemas/delivery.schema";
import { idParamSchema } from "../../schemas/product.schema";

const router = Router();

// All delivery routes require base JWT authentication
router.use(...requireAuth);

/**
 * @route   POST /delivery/upload-document
 * @desc    Upload KYC, NID, license, or vehicle documents
 * @access  Delivery Man, Customer (Applicant), Admin
 */
router.post(
  "/upload-document",
  requireRole("delivery_man", "customer", "admin"),
  deliveryDocumentUpload.single("file"),
  ctrl.uploadDeliveryDocument
);

// Profile management (delivery men, applicants & admin)
router.get("/profile", requireRole("delivery_man", "customer", "admin"), ctrl.getDeliveryManProfile);
router.patch(
  "/profile",
  requireRole("delivery_man", "customer", "admin"),
  validate({ body: createOrUpdateProfileSchema }),
  ctrl.createOrUpdateDeliveryManProfile
);

// Availability & location
router.patch(
  "/availability",
  requireRole("delivery_man"),
  validate({ body: setAvailabilitySchema }),
  ctrl.setAvailability
);
router.patch(
  "/location",
  requireRole("delivery_man"),
  validate({ body: updateLocationSchema }),
  ctrl.updateLocation
);
router.get("/stats", requireRole("delivery_man", "admin"), ctrl.getDeliveryManStats);

// Delivery requests (Marketplace & My Orders)
router.get("/requests/available", requireRole("delivery_man"), ctrl.getAvailableDeliveries);
router.get("/requests/my", requireRole("delivery_man"), ctrl.getMyDeliveries);
router.get(
  "/requests/:id",
  validate({ params: idParamSchema }),
  ctrl.getDeliveryById
);
router.patch(
  "/requests/:id/accept",
  requireRole("delivery_man"),
  validate({ params: idParamSchema }),
  ctrl.acceptDelivery
);
router.patch(
  "/requests/:id/status",
  requireRole("delivery_man", "admin"),
  validate({ params: idParamSchema, body: updateDeliveryStatusSchema }),
  ctrl.updateDeliveryStatus
);
router.patch(
  "/requests/:id/verify-otp",
  requireRole("delivery_man", "admin"),
  validate({ params: idParamSchema, body: verifyOtpSchema }),
  ctrl.verifyDeliveryOtp
);
router.post(
  "/requests/:id/proof",
  requireRole("delivery_man", "admin"),
  validate({ params: idParamSchema }),
  deliveryProofUpload.single("proofImage"),
  ctrl.uploadDeliveryProof
);

// Delivery Incidents
router.post(
  "/incidents",
  requireRole("delivery_man", "admin"),
  validate({ body: createIncidentSchema }),
  ctrl.createDeliveryIncident
);
router.post(
  "/requests/:id/incident",
  requireRole("delivery_man", "admin"),
  validate({ params: idParamSchema, body: reportIncidentSchema }),
  ctrl.reportDeliveryIncident
);
router.get("/incidents", requireRole("delivery_man"), ctrl.getMyIncidents);

// Seller Active Deliveries Scoped View
router.get("/seller/active-deliveries", requireRole("seller", "admin"), ctrl.getSellerActiveDeliveries);

// Customer Live Tracking & Rating
router.get("/tracking/:orderId", ctrl.getDeliveryTracking);
router.post(
  "/requests/:id/rate",
  requireRole("customer", "admin"),
  validate({ params: idParamSchema, body: rateDeliverySchema }),
  ctrl.rateDelivery
);
router.post(
  "/orders/:orderId/rate",
  requireRole("customer", "admin"),
  validate({ body: rateDeliverySchema }),
  ctrl.rateDelivery
);

// Admin: Delivery Operations & Verification
router.get("/admin/list", requireRole("admin"), ctrl.listDeliveryMen);
router.get("/admin/profile/:userId", requireRole("admin"), ctrl.getDeliveryManDetailAdmin);
router.patch(
  "/admin/profile/:userId/status",
  requireRole("admin"),
  ctrl.approveDeliveryMan
);
router.get("/admin/active-operations", requireRole("admin"), ctrl.listAdminActiveDeliveries);
router.get("/admin/heatmap", requireRole("admin"), ctrl.getAdminDeliveryHeatmap);
router.get("/admin/incidents", requireRole("admin"), ctrl.listAdminIncidents);
router.patch("/admin/incidents/:id/resolve", requireRole("admin"), ctrl.resolveAdminIncident);

// Reverse Delivery (Returns)
router.get("/reverse/available", requireRole("delivery_man"), ctrl.getAvailableReverseDeliveries);
router.get("/reverse/my", requireRole("delivery_man"), ctrl.getMyReverseDeliveries);
router.patch(
  "/reverse/:id/accept",
  requireRole("delivery_man"),
  validate({ params: idParamSchema }),
  ctrl.acceptReverseDelivery
);
router.patch(
  "/reverse/:id/status",
  requireRole("delivery_man", "admin"),
  validate({ params: idParamSchema, body: updateReverseDeliveryStatusSchema }),
  ctrl.updateReverseDeliveryStatus
);

export default router;
