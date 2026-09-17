import { Request, Response } from "express";
import { resizeImageFromUrl } from "../../utils/image";
import { asyncHandler } from "../../utils/async-handler";

export const resizeImage = asyncHandler(async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string | undefined;
  const width = parseInt(req.query.width as string || "400", 10);
  const format = (req.query.format as "webp" | "jpeg" | "png" || "webp");

  if (!imageUrl) {
    res.status(400).json({ error: "url query parameter is required" });
    return;
  }

  if (width < 50 || width > 2048) {
    res.status(400).json({ error: "width must be between 50 and 2048" });
    return;
  }

  try {
    const buffer = await resizeImageFromUrl(imageUrl, { width, format });
    res.set("Content-Type", `image/${format}`);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch {
    // If resizing fails for any reason, safely redirect directly to the original image
    res.redirect(imageUrl);
  }
});
