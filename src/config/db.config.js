import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

// Force pg driver to parse TIMESTAMP (without timezone, OID 1114) as UTC
pkg.types.setTypeParser(1114, (str) => {
  if (!str) return null;
  // Convert "YYYY-MM-DD HH:mm:ss" to UTC date object
  return new Date(str.replace(" ", "T") + "Z");
});

const isProduction = process.env.NODE_ENV === "production";

// Membuat koneksi ke postgres dengan pooling yang didesain untuk serverless
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: isProduction ? 2 : 10, // batasi jumlah koneksi di serverless production agar tidak exhausting
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 3000,
});
