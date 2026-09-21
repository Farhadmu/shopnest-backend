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

const heroBannerUploadDirectory = path.resolve(env.UPLOAD_DIR, "hero-banners");
fs.mkdirSync(heroBannerUploadDirectory, { recursive: true });

const heroBannerImageStorage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, heroBannerUploadDirectory),
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

const categoryUploadDirectory = path.resolve(env.UPLOAD_DIR, "categories");
fs.mkdirSync(categoryUploadDirectory, { recursive: true });

const categoryImageStorage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, categoryUploadDirectory),
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

export const heroBannerImageUpload = multer({
  storage: heroBannerImageStorage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      callback(ApiError.badRequest("Only image files can be uploaded for a hero banner"));
      return;
    }
    callback(null, true);
  },
});

export const categoryImageUpload = multer({
  storage: categoryImageStorage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      callback(ApiError.badRequest("Only image files can be uploaded for a category"));
      return;
    }
    callback(null, true);
  },
});

const deliveryUploadDirectory = path.resolve(env.UPLOAD_DIR, "delivery");
fs.mkdirSync(deliveryUploadDirectory, { recursive: true });

const deliveryStorage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, deliveryUploadDirectory),
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

export const deliveryDocumentUpload = multer({
  storage: deliveryStorage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.mimetype)) {
      callback(ApiError.badRequest("Only JPEG, PNG, WebP or PDF files can be uploaded"));
      return;
    }
    callback(null, true);
  },
});

export const deliveryProofUpload = multer({
  storage: deliveryStorage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      callback(ApiError.badRequest("Only image files can be uploaded as delivery proof"));
      return;
    }
    callback(null, true);
  },
});

const complaintUploadDirectory = path.resolve(env.UPLOAD_DIR, "complaints");
fs.mkdirSync(complaintUploadDirectory, { recursive: true });

const complaintStorage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, complaintUploadDirectory),
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

export const complaintEvidenceUpload = multer({
  storage: complaintStorage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 5 },
  fileFilter: (_request, file, callback) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      callback(ApiError.badRequest("Only JPG, PNG, or WebP files can be uploaded"));
      return;
    }
    callback(null, true);
  },
});

const visualSearchUploadDirectory = path.resolve(env.UPLOAD_DIR, "visual-search");
fs.mkdirSync(visualSearchUploadDirectory, { recursive: true });

const visualSearchStorage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, visualSearchUploadDirectory),
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

export const visualSearchImageUpload = multer({
  storage: visualSearchStorage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      callback(ApiError.badRequest("Only image files can be uploaded for visual search"));
      return;
    }
    callback(null, true);
  },
});

