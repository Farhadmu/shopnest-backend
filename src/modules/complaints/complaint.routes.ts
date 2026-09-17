import { Router } from "express";
import * as ctrl from "./complaint.controller";
import { attachUserIfPresent, requireAuth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { createComplaintSchema, complaintQuerySchema } from "../../schemas/complaint.schema";
import { aiLimiter } from "../../middlewares/rate-limit.middleware";
import { complaintEvidenceUpload } from "../../middlewares/upload.middleware";

const router = Router();

router.use(attachUserIfPresent);

router.post(
  "/complaints",
  aiLimiter,
  complaintEvidenceUpload.array("attachments", 5),
  validate({ body: createComplaintSchema }),
  ctrl.createCustomerComplaint,
);
router.get("/complaints", requireAuth, validate({ query: complaintQuerySchema }), ctrl.getCustomerComplaints);
router.get("/complaints/:id", requireAuth, ctrl.getCustomerComplaintById);

router.post(
  "/delivery/complaints",
  aiLimiter,
  complaintEvidenceUpload.array("attachments", 5),
  validate({ body: createComplaintSchema }),
  ctrl.createDeliveryComplaint,
);
router.get("/delivery/complaints", requireAuth, validate({ query: complaintQuerySchema }), ctrl.getDeliveryComplaints);
router.get("/delivery/complaints/:id", requireAuth, ctrl.getDeliveryComplaintById);

router.post(
  "/seller/complaints",
  aiLimiter,
  complaintEvidenceUpload.array("attachments", 5),
  validate({ body: createComplaintSchema }),
  ctrl.createSellerComplaint,
);
router.get("/seller/complaints", requireAuth, validate({ query: complaintQuerySchema }), ctrl.getSellerComplaints);
router.get("/seller/complaints/:id", requireAuth, ctrl.getSellerComplaintById);

export default router;
