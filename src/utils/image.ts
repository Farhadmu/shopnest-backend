import sharp from "sharp";

const IMAGE_RESIZE_CACHE_TTL_MS = 10 * 60 * 1000;
const resizeCache = new Map<string, { value: Buffer; expiresAt: number }>();


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

  try {
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

    return await pipeline.toBuffer();
  } catch {
    // Fallback to original buffer if sharp fails on any irregular format/encoding
    return input;
  }
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

  const buffer = Buffer.from(await response.arrayBuffer());
  const resized = await resizeImageBuffer(buffer, options);

  resizeCache.set(cacheKey, { value: resized, expiresAt: Date.now() + IMAGE_RESIZE_CACHE_TTL_MS });

  return resized;
}
