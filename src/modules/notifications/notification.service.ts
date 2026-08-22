import { Notification, NotificationType } from "./notification.model";

/**
 * Creates an in-app notification for a user. Called directly by other
 * modules (not over HTTP) whenever a notification-worthy event occurs,
 * e.g. an order status change, a price drop, a new review, etc.
 * Never throws — a notification failure should not break the caller's flow.
 */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  link?: string,
  relatedId?: string
): Promise<void> {
  try {
    await Notification.create({ userId, type, title, message, link, relatedId });
  } catch {
    // Best-effort; swallow errors so notification delivery never blocks callers.
  }
}
