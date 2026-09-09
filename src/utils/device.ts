import { Request } from "express";

export interface ParsedDevice {
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
}

/**
 * Parses user agent string into browser, operating system, and device type.
 */
export function parseUserAgent(ua?: string): ParsedDevice {
  if (!ua) {
    return {
      browser: "Unknown Browser",
      os: "Unknown OS",
      deviceType: "unknown",
    };
  }

  let deviceType: "desktop" | "mobile" | "tablet" | "unknown" = "desktop";
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    deviceType = "tablet";
  } else if (/mobile|iphone|ipod|blackberry|opera mini|iemobile|wpdesktop/i.test(ua)) {
    deviceType = "mobile";
  }

  let os = "Unknown OS";
  if (/windows nt 10/i.test(ua)) os = "Windows 10/11";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "Unknown Browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = "Safari";

  return { browser, os, deviceType };
}

/**
 * Extracts client IP from request headers or socket.
 */
export function getClientIp(req: Request | { headers?: Record<string, any>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  let ip = "";
  if (typeof forwarded === "string") {
    ip = forwarded.split(",")[0].trim();
  } else if (Array.isArray(forwarded) && forwarded[0]) {
    ip = String(forwarded[0]).trim();
  } else if (req.socket?.remoteAddress) {
    ip = req.socket.remoteAddress;
  } else {
    ip = "127.0.0.1";
  }

  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }
  return ip;
}

/**
 * Masks IP address to preserve privacy while maintaining subnet matchability.
 */
export function maskIp(ip: string): string {
  if (!ip) return "127.0.0.***";
  const cleanIp = ip.startsWith("::ffff:") ? ip.substring(7) : ip;
  const parts = cleanIp.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
  }
  return cleanIp;
}
