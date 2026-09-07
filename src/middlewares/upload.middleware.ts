import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { env } from "../config/env";
import { ApiError } from "../utils/api-error";

const reviewUploadDirectory = path.resolve(env.UPLOAD_DIR, "reviews");
fs.mkdirSync(reviewUploadDirectory, { recursive: true });

const reviewImageStorage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, reviewUploadDirectory),
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

export const reviewImageUpload = multer({
  storage: reviewImageStorage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 5 },
  fileFilter: (_request, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      callback(ApiError.badRequest("Only image files can be uploaded with a review"));
      return;
    }
    callback(null, true);
  },
});
