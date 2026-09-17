import sharp from "sharp";

const IMAGE_RESIZE_CACHE_TTL_MS = 10 * 60 * 1000;
const resizeCache = new Map<string, { value: Buffer; expiresAt: number }>();

const SUPPORTED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
  "image/svg+xml",
]);

function isSupportedImage(contentType: string | undefined): boolean {
  if (!contentType) return true;
  const clean = contentType.split(";")[0].trim().toLowerCase();
  return clean.startsWith("image/") || SUPPORTED_CONTENT_TYPES.has(clean);
}

export interface ResizeOptions {
  width: number;
  format?: "webp" | "jpeg" | "png";
  quality?: number;
}

export async function resizeImageBuffer(
  input: Buffer,
  options: ResizeOptions
): Promise<Buffer> {
  const { width, format = "webp", quality = 80 } = options;

  let pipeline = sharp(input).resize(width, null, { withoutEnlargement: true });

  switch (format) {
    case "webp":
      pipeline = pipeline.webp({ quality });
      break;
    case "jpeg":
      pipeline = pipeline.jpeg({ quality });
      break;
    case "png":
      pipeline = pipeline.png({ quality });
      break;
  }

  return pipeline.toBuffer();
}

export async function resizeImageFromUrl(
  imageUrl: string,
  options: ResizeOptions
): Promise<Buffer> {
  const cacheKey = `${imageUrl}|${options.width}|${options.format || "webp"}`;
  const cached = resizeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (!isSupportedImage(contentType ?? undefined)) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const resized = await resizeImageBuffer(buffer, options);

  resizeCache.set(cacheKey, { value: resized, expiresAt: Date.now() + IMAGE_RESIZE_CACHE_TTL_MS });

  return resized;
}
