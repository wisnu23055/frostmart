import * as ordersRepository from "./orders.repository.js";
import { db } from "../../config/db.config.js";
import { deleteCache } from "../../utils/cache.js";
import { uploadImage } from "../../utils/cloudinary.js";

const invalidateProductsCache = async () => {
  await deleteCache("cache:/api/products*");
};

const withItems = async (order) => {
  const items = await ordersRepository.getOrderItems(order.id);
  return { ...order, items };
};

export const checkout = async (userId, payload, file) => {
  // Validate and upload payment proof if non-COD
  let paymentProofUrl = null;
  const paymentMethodName = payload.payment_method || "";
  const isCod = paymentMethodName.toLowerCase() === "cash" || paymentMethodName === "Bayar di Tempat (COD)";

  if (!isCod) {
    if (!file) {
      throw new Error("Bukti pembayaran wajib diunggah untuk metode pembayaran non-COD.");
    }
    try {
      const uploadResult = await uploadImage(file.buffer);
      paymentProofUrl = uploadResult.secure_url;
    } catch (err) {
      console.error("Cloudinary upload failed:", err);
      throw new Error("Gagal mengunggah bukti pembayaran.");
    }
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    let totalPrice = 0;
    const preparedItems = [];

    for (const item of payload.items) {
      const product = await ordersRepository.getProductForUpdate(
        client,
        item.product_id,
      );

      if (!product) {
        throw new Error(`Product id ${item.product_id} not found`);
      }

      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for product id ${item.product_id}`);
      }

      const linePrice = Number(product.price) * item.quantity;
      totalPrice += linePrice;

      preparedItems.push({
        product,
        quantity: item.quantity,
      });
    }

    const shippingAddress = payload.shippingAddress || payload.shipping_address || null;
    const order = await ordersRepository.createOrder(client, userId, totalPrice, "pending", shippingAddress);

    for (const item of preparedItems) {
      await ordersRepository.createOrderItem(
        client,
        order.id,
        item.product.id,
        item.quantity,
        item.product.price,
      );

      await ordersRepository.reduceProductStock(client, item.product.id, item.quantity);

      await ordersRepository.insertInventoryLog(
        client,
        item.product.id,
        "OUT",
        item.quantity,
        `Checkout order #${order.id} by user #${userId}`,
      );
    }

    const transaction = await ordersRepository.createTransaction(
      client,
      order.id,
      payload.payment_method,
      "pending",
      paymentProofUrl
    );

    await client.query("COMMIT");

    await invalidateProductsCache();

    return {
      order: await withItems(order),
      transaction,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const getOrderById = async (id, requester) => {
  let order = await ordersRepository.getOrderById(id);
  if (!order) throw new Error("Order not found");

  const isAdmin = requester.role === "admin";
  const isOwner = order.user_id === requester.id;

  if (!isAdmin && !isOwner) {
    throw new Error("Forbidden");
  }

  // On-demand check for 10-minute expiration of unpaid non-COD order
  const createdAtTime = new Date(order.created_at).getTime();
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  if (
    order.status === "pending" &&
    order.payment_method !== "Bayar di Tempat (COD)" &&
    order.payment_status !== "paid" &&
    (!order.payment_proof_url || order.payment_proof_url.trim() === "") &&
    createdAtTime < tenMinutesAgo
  ) {
    console.log(`[Order Expiry] Order #${order.id} expired on-demand, cancelling...`);
    order = await updateOrderStatus(order.id, "cancelled");
  }

  // On-demand check for 7-day completion of paid orders
  const processedAtTime = order.processed_at ? new Date(order.processed_at).getTime() : null;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (
    order.status === "paid" &&
    processedAtTime &&
    processedAtTime < sevenDaysAgo
  ) {
    console.log(`[Order Expiry] Order #${order.id} auto-completed on-demand after 7 days...`);
    order = await updateOrderStatus(order.id, "completed");
  }

  return await withItems(order);
};

export const getMyOrders = async (userId) => {
  const orders = await ordersRepository.getOrdersByUserId(userId);
  const checkedOrders = [];

  for (let order of orders) {
    const createdAtTime = new Date(order.created_at).getTime();
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    if (
      order.status === "pending" &&
      order.payment_method !== "Bayar di Tempat (COD)" &&
      order.payment_status !== "paid" &&
      (!order.payment_proof_url || order.payment_proof_url.trim() === "") &&
      createdAtTime < tenMinutesAgo
    ) {
      try {
        console.log(`[Order Expiry] Order #${order.id} expired during list fetch, cancelling...`);
        order = await updateOrderStatus(order.id, "cancelled");
      } catch (err) {
        console.error(`Failed to cancel order #${order.id} during list fetch:`, err);
      }
    }

    // 7-day auto completion check
    const processedAtTime = order.processed_at ? new Date(order.processed_at).getTime() : null;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (
      order.status === "paid" &&
      processedAtTime &&
      processedAtTime < sevenDaysAgo
    ) {
      try {
        console.log(`[Order Expiry] Order #${order.id} auto-completed during list fetch, 7 days passed.`);
        order = await updateOrderStatus(order.id, "completed");
      } catch (err) {
        console.error(`Failed to auto-complete order #${order.id} during list fetch:`, err);
      }
    }

    checkedOrders.push(order);
  }

  // Batch fetch items to solve N+1 query problem
  const orderIds = checkedOrders.map((o) => o.id);
  const allItems = await ordersRepository.getBatchOrderItems(orderIds);

  const itemsByOrderId = {};
  allItems.forEach((item) => {
    if (!itemsByOrderId[item.order_id]) {
      itemsByOrderId[item.order_id] = [];
    }
    itemsByOrderId[item.order_id].push(item);
  });

  return checkedOrders.map((order) => ({
    ...order,
    items: itemsByOrderId[order.id] || [],
  }));
};

export const getAllOrders = async () => {
  const orders = await ordersRepository.getOrders();
  const checkedOrders = [];

  for (let order of orders) {
    const createdAtTime = new Date(order.created_at).getTime();
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    if (
      order.status === "pending" &&
      order.payment_method !== "Bayar di Tempat (COD)" &&
      order.payment_status !== "paid" &&
      (!order.payment_proof_url || order.payment_proof_url.trim() === "") &&
      createdAtTime < tenMinutesAgo
    ) {
      try {
        console.log(`[Order Expiry] Order #${order.id} expired during admin list fetch, cancelling...`);
        order = await updateOrderStatus(order.id, "cancelled");
      } catch (err) {
        console.error(`Failed to cancel order #${order.id} during admin list fetch:`, err);
      }
    }

    // 7-day auto completion check
    const processedAtTime = order.processed_at ? new Date(order.processed_at).getTime() : null;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (
      order.status === "paid" &&
      processedAtTime &&
      processedAtTime < sevenDaysAgo
    ) {
      try {
        console.log(`[Order Expiry] Order #${order.id} auto-completed during admin list fetch, 7 days passed.`);
        order = await updateOrderStatus(order.id, "completed");
      } catch (err) {
        console.error(`Failed to auto-complete order #${order.id} during admin list fetch:`, err);
      }
    }

    checkedOrders.push(order);
  }

  // Batch fetch items to solve N+1 query problem
  const orderIds = checkedOrders.map((o) => o.id);
  const allItems = await ordersRepository.getBatchOrderItems(orderIds);

  const itemsByOrderId = {};
  allItems.forEach((item) => {
    if (!itemsByOrderId[item.order_id]) {
      itemsByOrderId[item.order_id] = [];
    }
    itemsByOrderId[item.order_id].push(item);
  });

  return checkedOrders.map((order) => ({
    ...order,
    items: itemsByOrderId[order.id] || [],
  }));
};

export const updateOrderStatus = async (id, status) => {
  const existing = await ordersRepository.getOrderById(id);
  if (!existing) throw new Error("Order not found");

  if (status === existing.status) {
    return existing;
  }

  const payMethod = existing.payment_method || "";
  const isCod = payMethod.toLowerCase() === "cash" || payMethod === "Bayar di Tempat (COD)";

  if (["paid", "completed"].includes(status)) {
    const transaction = await ordersRepository.getTransactionByOrderId(id);

    if (!transaction) {
      throw new Error("Transaction not found for this order");
    }

    // If it is NOT a COD order, enforce transaction status is paid
    if (!isCod) {
      if (transaction.payment_status !== "paid") {
        throw new Error(
          "Order cannot be marked paid/completed while payment status is not paid",
        );
      }
    }
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    if (status === "cancelled" && existing.status !== "cancelled") {
      const items = await ordersRepository.getOrderItems(id);
      for (const item of items) {
        await client.query(`UPDATE products SET stock = stock + $1 WHERE id = $2`, [
          item.quantity,
          item.product_id,
        ]);
        await client.query(
          `INSERT INTO inventory_log(product_id, change_type, quantity, description)
           VALUES ($1, $2, $3, $4)`,
          [
            item.product_id,
            "IN",
            item.quantity,
            `Order #${id} status changed to cancelled`,
          ],
        );
      }

      const transaction = await ordersRepository.getTransactionByOrderId(id);
      if (transaction && transaction.payment_status === "pending") {
        await client.query(
          `UPDATE transactions SET payment_status = 'failed' WHERE id = $1`,
          [transaction.id],
        );
      }
    }

    // Update processed_at timestamp when transitioning to 'paid' (proses)
    if (status === "paid" && existing.status !== "paid") {
      await client.query(
        `UPDATE orders SET processed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id]
      );
    }

    // For COD orders, auto mark transaction as paid when order becomes completed
    if (isCod && status === "completed") {
      const transaction = await ordersRepository.getTransactionByOrderId(id);
      if (transaction && transaction.payment_status !== "paid") {
        await client.query(
          `UPDATE transactions SET payment_status = 'paid' WHERE id = $1`,
          [transaction.id]
        );
      }
    }

    const { rows } = await client.query(
      `UPDATE orders SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id],
    );

    await client.query("COMMIT");
    await invalidateProductsCache();
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const confirmPayment = async (orderId, requester, file) => {
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) throw new Error("Order not found");

  const isOwner = order.user_id === requester.id;
  if (!isOwner && requester.role !== "admin") {
    throw new Error("Forbidden");
  }

  if (order.status !== "pending") {
    throw new Error("Only pending orders can be paid");
  }

  let paymentProofUrl = null;
  if (file) {
    try {
      const uploadResult = await uploadImage(file.buffer);
      paymentProofUrl = uploadResult.secure_url;
    } catch (err) {
      console.error("Gagal mengunggah bukti pembayaran di confirmPayment:", err);
      throw new Error("Gagal mengunggah bukti pembayaran.");
    }
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1. Update transaction status to paid and payment_proof_url if provided
    const transaction = await ordersRepository.getTransactionByOrderId(orderId);
    if (transaction) {
      if (paymentProofUrl) {
        await client.query(
          `UPDATE transactions SET payment_status = 'paid', payment_proof_url = $1 WHERE id = $2`,
          [paymentProofUrl, transaction.id]
        );
      } else {
        await client.query(
          `UPDATE transactions SET payment_status = 'paid' WHERE id = $1`,
          [transaction.id]
        );
      }
    }

    await client.query("COMMIT");
    return { success: true, message: "Payment confirmed successfully" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const completeOrder = async (orderId, requester) => {
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) throw new Error("Order not found");

  const isOwner = order.user_id === requester.id;
  if (!isOwner && requester.role !== "admin") {
    throw new Error("Forbidden");
  }

  if (order.status !== "paid") {
    throw new Error("Only processed orders can be completed");
  }

  return await updateOrderStatus(orderId, "completed");
};

