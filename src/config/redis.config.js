import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

export const redisClient = createClient({
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err);
});

// Panggil connect tanpa await di level atas agar tidak memblokir startup serverless
redisClient.connect().catch((err) => {
  console.error("Failed to connect to Redis on startup:", err);
});

