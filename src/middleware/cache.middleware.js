import { getCache, setCache } from "../utils/cache.js";

export const cacheMiddleware = (ttl = 60) => {
  return async (req, res, next) => {
    try {
      const key = `cache:${req.originalUrl}`;

      const cached = await getCache(key);
      if (cached) {
        return res.json({
          source: "cache",
          ...cached,
        });
      }

      const originalJson = res.json.bind(res);

      res.json = (data) => {
        // Simpan cache di background tanpa await agar respon ke user tidak tertunda
        setCache(key, data, ttl).catch((err) => {
          console.error("Failed to write cache in background:", err);
        });
        return originalJson({
          source: "db",
          ...data,
        });
      };

      next();
    } catch (err) {
      next();
    }
  };
};
