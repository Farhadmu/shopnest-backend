import sharp from "sharp";
import { URL } from "url";
import { logger } from "../../utils/logger";

export interface ImageValidationResult {
  isValid: boolean;
  format?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  error?: string;
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB (supports high-res phone camera photos)
const MIN_IMAGE_SIZE_BYTES = 100; // 100 Bytes
const MAX_DIMENSION = 8000;
const MIN_DIMENSION = 10;

/**
 * Checks magic bytes of common image formats
 */
export function checkMagicBytes(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WEBP: RIFF ... WEBP
  const riff = buffer.toString("ascii", 0, 4);
  const webp = buffer.toString("ascii", 8, 12);
  if (riff === "RIFF" && webp === "WEBP") {
    return "image/webp";
  }

  return null;
}

/**
 * Validates an image buffer strictly using magic bytes and Sharp metadata decoding
 */
export async function validateImageBuffer(buffer: Buffer): Promise<ImageValidationResult> {
  if (!buffer || buffer.length === 0) {
    return { isValid: false, error: "Empty image payload" };
  }

  if (buffer.length < MIN_IMAGE_SIZE_BYTES) {
    return { isValid: false, error: "Image file is too small or corrupted" };
  }

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    return { isValid: false, error: "Image exceeds maximum allowed size of 5MB" };
  }

  const magicMime = checkMagicBytes(buffer);
  if (!magicMime || !ALLOWED_MIME_TYPES.has(magicMime)) {
    return {
      isValid: false,
      error: "Unsupported file format. Please upload JPG, PNG, or WebP",
    };
  }

  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      return {
        isValid: false,
        error: `Image dimensions too small (minimum ${MIN_DIMENSION}x${MIN_DIMENSION}px)`,
      };
    }

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      return {
        isValid: false,
        error: `Image dimensions exceed maximum allowed (${MAX_DIMENSION}x${MAX_DIMENSION}px)`,
      };
    }

    return {
      isValid: true,
      format: metadata.format || magicMime.split("/")[1],
      width,
      height,
      fileSize: buffer.length,
    };
  } catch (err: any) {
    logger.warn("Sharp image parsing failed (corrupted image)", { error: err?.message });
    return {
      isValid: false,
      error: "Corrupted or invalid image file",
    };
  }
}

/**
 * Unwraps Next.js optimized image URLs or extracts relative uploads paths
 */
export function unwrapImageUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";

  // 1. If URL contains Next.js image proxy /_next/image?url=...
  if (rawUrl.includes("_next/image") && rawUrl.includes("url=")) {
    try {
      const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : `http://localhost:3000${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`);
      const encodedParam = parsed.searchParams.get("url");
      if (encodedParam) {
        const decoded = decodeURIComponent(encodedParam);
        return unwrapImageUrl(decoded);
      }
    } catch {
      // ignore parsing error and continue
    }
  }

  // 2. Normalize local dev server URLs (e.g. http://localhost:3000/uploads/... or http://localhost:5000/uploads/...)
  const uploadMatch = rawUrl.match(/https?:\/\/[^/]+(\/uploads\/[^\s?#]+)/i);
  if (uploadMatch) {
    return uploadMatch[1];
  }

  return rawUrl.trim();
}

/**
 * Validates remote image URLs to prevent SSRF and internal network access
 */
export function isSafeRemoteUrl(rawUrl: string, allowLocalhost = false): { isSafe: boolean; error?: string } {
  try {
    const unwrapped = unwrapImageUrl(rawUrl);
    if (unwrapped.startsWith("/uploads/")) {
      return { isSafe: true };
    }
    const parsed = new URL(unwrapped);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { isSafe: false, error: "Invalid URL protocol. Only HTTP and HTTPS are permitted." };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost, link-local, loopback unless explicitly allowed
    if (
      !allowLocalhost &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "0.0.0.0" ||
        hostname === "::1" ||
        hostname === "169.254.169.254" || // AWS / GCP metadata
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal"))
    ) {
      return { isSafe: false, error: "Access to private or local network hosts is prohibited." };
    }

    // Block IPv4 private address ranges
    // 10.0.0.0/8
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { isSafe: false, error: "Access to private RFC1918 addresses is prohibited." };
    }
    // 172.16.0.0/12
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { isSafe: false, error: "Access to private RFC1918 addresses is prohibited." };
    }
    // 192.168.0.0/16
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { isSafe: false, error: "Access to private RFC1918 addresses is prohibited." };
    }

    return { isSafe: true };
  } catch {
    return { isSafe: false, error: "Invalid image URL" };
  }
}

