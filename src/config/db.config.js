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

// Membuat koneksi ke postgres dengan pooling
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});
