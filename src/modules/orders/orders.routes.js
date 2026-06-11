import { Router } from "express";
import * as ordersController from "./orders.controller.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { authorizeRoles } from "../../middleware/authorizeRoles.js";
import upload from "../../middleware/upload.middleware.js";
import { handleUploadError } from "../../middleware/handleUploadError.js";

const router = Router();

router.use(authMiddleware);

router.post("/checkout", handleUploadError(upload.single("payment_proof")), ordersController.checkout);
router.post("/:id/confirm-payment", handleUploadError(upload.single("payment_proof")), ordersController.confirmPayment);
router.post("/:id/complete-order", ordersController.completeOrder);
router.get("/my", ordersController.getMyOrders);
router.get("/:id", ordersController.getOrderById);

router.get("/", authorizeRoles(["admin"]), ordersController.getAllOrders);
router.patch(
  "/:id/status",
  authorizeRoles(["admin"]),
  ordersController.updateOrderStatus,
);

export default router;
