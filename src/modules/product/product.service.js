import { deleteImage, uploadImage } from "../../utils/cloudinary.js";
import * as productRepository from "./product.repository.js";
import { deleteCache } from "../../utils/cache.js";
import { redisClient } from "../../config/redis.config.js";

const invalidateProductsCache = async () => {
  await deleteCache("cache:/api/products*");
};

export const createProduct = async (data) => {
  await invalidateProductsCache();
  return await productRepository.createProduct(data);
};

export const updateProduct = async (id, data) => {
  const existing = await productRepository.getProductById(id);
  if (!existing) {
    throw new Error("Product is not found!");
  }
  await invalidateProductsCache();
  return await productRepository.updateProduct(id, data);
};

export const getProductById = async (id) => {
  const product = await productRepository.getProductById(id);
  if (!product) {
    throw new Error("Product not found");
  }

  const keys = ["image", "image2", "image3", "image4"];
  const redisKeys = keys.map((key) => key === "image" ? `product:image:${id}` : `product:${key}:${id}`);
  const mGetResults = await redisClient.mGet(redisKeys);
  keys.forEach((key, index) => {
    const imageMeta = mGetResults[index];
    if (imageMeta) {
      product[key] = JSON.parse(imageMeta);
    }
  });

  return product;
};

export const getProductsWithPagination = async (page, limit, search = "") => {
  const products = await productRepository.getProducts(page, limit, search);

  const keys = ["image", "image2", "image3", "image4"];
  const redisKeys = [];
  products.forEach((product) => {
    keys.forEach((key) => {
      const redisKey = key === "image" ? `product:image:${product.id}` : `product:${key}:${product.id}`;
      redisKeys.push(redisKey);
    });
  });

  if (redisKeys.length > 0) {
    const mGetResults = await redisClient.mGet(redisKeys);
    let index = 0;
    products.forEach((product) => {
      keys.forEach((key) => {
        const imageMeta = mGetResults[index++];
        if (imageMeta) {
          product[key] = JSON.parse(imageMeta);
        }
      });
    });
  }

  const totalData = await productRepository.getPages(limit, search);
  return {
    page,
    limit,
    search,
    total_pages: Number(totalData.total_pages),
    data: products,
  };
};

export const deleteProduct = async (id) => {
  const existing = await productRepository.getProductById(id);
  if (!existing) {
    throw new Error("Product not found");
  }

  // Hapus semua foto dari Redis dan Cloudinary
  const keys = ["image", "image2", "image3", "image4"];
  const redisKeys = keys.map((key) => key === "image" ? `product:image:${id}` : `product:${key}:${id}`);
  const existingImages = await redisClient.mGet(redisKeys);
  
  for (let i = 0; i < keys.length; i++) {
    const existingImage = existingImages[i];
    if (existingImage) {
      const { public_id } = JSON.parse(existingImage);
      deleteImage(public_id).catch(() => {});
      await redisClient.del(redisKeys[i]);
    }
  }

  await productRepository.deleteProduct(id);
  await invalidateProductsCache();
};

export const uploadProductPhoto = async (id, files) => {
  if (!files || Object.keys(files).length === 0) {
    throw new Error("File tidak ditemukan");
  }
  const product = await getProductById(id);
  if (!product) throw new Error("Product tidak ditemukan");

  const keys = ["image", "image2", "image3", "image4"];
  for (const key of keys) {
    const file = files?.[key]?.[0];
    if (file) {
      const redisKey = key === "image" ? `product:image:${id}` : `product:${key}:${id}`;
      // Jalankan upload di latar belakang secara asinkronus (non-blocking)
      uploadImage(file.buffer)
        .then(async (result) => {
          await redisClient.set(
            redisKey,
            JSON.stringify({
              url: result.secure_url,
              public_id: result.public_id,
            }),
            { EX: 60 * 60 * 24 * 30 },
          );
          await invalidateProductsCache();
          console.log(`[Background Upload] Berhasil mengunggah ${key} produk ID ${id}`);
        })
        .catch((err) => {
          console.error(`[Background Upload] Gagal mengunggah ${key} produk ID ${id}:`, err);
        });
    }
  }

  // Langsung kembalikan respons cepat ke client
  return "Upload started in background";
};

export const replaceProductPhoto = async (id, files) => {
  if (!files || Object.keys(files).length === 0) {
    throw new Error("File tidak ditemukan");
  }

  await getProductById(id);
  const keys = ["image", "image2", "image3", "image4"];
  for (const key of keys) {
    const file = files?.[key]?.[0];
    if (file) {
      const redisKey = key === "image" ? `product:image:${id}` : `product:${key}:${id}`;
      const existingImage = await redisClient.get(redisKey);
      if (existingImage) {
        const { public_id: oldPublicId } = JSON.parse(existingImage);
        // Hapus gambar lama di latar belakang
        deleteImage(oldPublicId).catch((err) => {
          console.error(`[Background Delete] Gagal menghapus gambar lama ${key} produk ID ${id}:`, err);
        });
      }

      // Jalankan upload gambar baru di latar belakang secara asinkronus (non-blocking)
      uploadImage(file.buffer)
        .then(async (result) => {
          await redisClient.set(
            redisKey,
            JSON.stringify({
              url: result.secure_url,
              public_id: result.public_id,
            }),
            { EX: 60 * 60 * 24 * 30 },
          );
          await invalidateProductsCache();
          console.log(`[Background Replace] Berhasil mengganti ${key} produk ID ${id}`);
        })
        .catch((err) => {
          console.error(`[Background Replace] Gagal mengganti ${key} produk ID ${id}:`, err);
        });
    }
  }

  // Langsung kembalikan respons cepat ke client
  return "Replacement started in background";
};

export const deleteProductPhoto = async (id) => {
  await getProductById(id);
  const keys = ["image", "image2", "image3", "image4"];
  const redisKeys = keys.map((key) => key === "image" ? `product:image:${id}` : `product:${key}:${id}`);
  const existingImages = await redisClient.mGet(redisKeys);
  let deletedAny = false;

  for (let i = 0; i < keys.length; i++) {
    const existingImage = existingImages[i];
    if (existingImage) {
      const { public_id: publicId } = JSON.parse(existingImage);
      await deleteImage(publicId);
      await redisClient.del(redisKeys[i]);
      deletedAny = true;
    }
  }

  if (!deletedAny) {
    throw new Error("Foto tidak ditemukan");
  }

  // INVALIDATE CACHE
  await invalidateProductsCache();
};
