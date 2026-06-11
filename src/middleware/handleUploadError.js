import multer from "multer";

export const handleUploadError = (middleware) => {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            message: "Ukuran file terlalu besar. Maksimal 2MB.",
          });
        }
      }

      if (err) {
        return res.status(400).json({
          message: err.message,
        });
      }

      next();
    });
  };
};
