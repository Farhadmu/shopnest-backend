import { Response } from "express";

/**
 * Standard success envelope helper.
 * NOTE: the frontend's fetch helpers (src/lib/core/server.ts) currently do
 * `response.json()` and treat the WHOLE body as the resource (e.g. Cart,
 * Product[]), they do not unwrap a `.data` field. To stay 100% compatible
 * with the already-written frontend contracts we spread object payloads at
 * the top level (plus `success`/`message` for forward compatibility), and
 * wrap primitives/arrays under `data` only when the target type is not an
 * object (arrays ARE returned raw, since Product[] etc. is expected raw).
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string,
  statusCode = 200
): Response {
  if (Array.isArray(data)) {
    return res.status(statusCode).json(data);
  }
  if (data && typeof data === "object") {
    return res.status(statusCode).json({ success: true, message, ...(data as object) });
  }
  return res.status(statusCode).json({ success: true, message, data });
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  limit: number,
  message?: string
): Response {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return res.status(200).json({ success: true, message, items, total, page, limit, totalPages });
}
