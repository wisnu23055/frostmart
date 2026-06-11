import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import passport from "passport";
import cors from "cors";
import productRoutes from "./modules/product/product.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import addressesRoutes from "./modules/addresses/addresses.routes.js";
import ordersRoutes from "./modules/orders/orders.routes.js";
import transactionsRoutes from "./modules/transactions/transactions.routes.js";
import inventoryLogsRoutes from "./modules/inventory-logs/inventory-logs.routes.js";
import storeRegistrationsRoutes from "./modules/store-registrations/store-registrations.routes.js";
import helmet from "helmet";
import { xss } from "express-xss-sanitizer";
import logger from "./middleware/logger.middleware.js";
import { ensureSchema } from "./config/schema.config.js";
import { startOrderExpiryCheck } from "./modules/orders/orders.cron.js";

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",") : "http://localhost:5173",
    allowedHeaders: ["Authorization", "Content-Type"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  }),
);

app.use(helmet());
app.use(xss());
app.use(logger);

app.use(passport.initialize());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.use("/api/products", productRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/addresses", addressesRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/transactions", transactionsRoutes);
app.use("/api/inventory-logs", inventoryLogsRoutes);
app.use("/api/store-registrations", storeRegistrationsRoutes);

const startServer = async () => {
  await ensureSchema();
  startOrderExpiryCheck();

  app.listen(port, () => {
    console.log(`App listening on port ${port}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
