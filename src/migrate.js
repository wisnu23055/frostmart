import { ensureSchema } from "./config/schema.config.js";

console.log("Starting database schema migration...");
ensureSchema()
  .then(() => {
    console.log("Database schema migration completed successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Database schema migration failed:", err);
    process.exit(1);
  });
