import { Router } from "express";
import * as ctrl from "./invoice.controller";
import { requireAuth, attachUserIfPresent } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { generateInvoiceSchema, invoiceIdParamSchema } from "../../schemas/invoice.schema";

const router = Router();

router.get("/:orderId", attachUserIfPresent, validate({ params: invoiceIdParamSchema }), ctrl.getInvoice);
router.post("/generate", ...requireAuth, requireRole("seller", "admin"), validate({ body: generateInvoiceSchema }), ctrl.generateInvoice);
router.get("/seller/mine", ...requireAuth, requireRole("seller", "admin"), ctrl.listSellerInvoices);

export default router;
