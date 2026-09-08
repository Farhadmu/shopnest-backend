import type { Response } from "express";
import mongoose from "mongoose";
import { Notification, type INotification, type NotificationType, type NotificationCategory, type NotificationPriority, type NotificationSource, type RecipientType } from "./notification.model";

type NotificationInput = Pick<INotification, "userId" | "recipientType" | "type" | "category" | "priority" | "source" | "title" | "message" | "link" | "relatedId" | "relatedType">;

const subscribers = new Map<string, Set<Response>>();

function toPayload(notification: INotification) {
  const data = notification.toJSON() as Record<string, unknown>;
  return {
    ...data,
    createdAt: new Date(notification.createdAt).toISOString(),
    updatedAt: new Date(notification.updatedAt).toISOString(),
  };
}

function emit(userId: string, event: string, payload: unknown) {
  const userSubscribers = subscribers.get(userId);
  if (!userSubscribers) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of userSubscribers) {
    try {
      response.write(message);
    } catch {
      userSubscribers.delete(response);
    }
  }
  if (userSubscribers.size === 0) subscribers.delete(userId);
}

/** Creates a MongoDB notification and immediately pushes it to open SSE clients. */
export async function createNotification(input: NotificationInput) {
  const notification = await Notification.create({
    ...input,
    recipientType: input.recipientType ?? "user",
    category: input.category ?? "system",
    priority: input.priority ?? "info",
    source: input.source ?? "system",
  });
  emit(input.userId, "notification", toPayload(notification));
  return notification;
}

/** Creates an admin notification without requiring a specific admin userId. */
export async function createAdminNotification(input: Omit<NotificationInput, "userId" | "recipientType">) {
  const adminUsers = await mongoose.connection.db?.collection("user").find({ role: "admin" }).toArray();
  if (!adminUsers || adminUsers.length === 0) return null;

  const promises = adminUsers.map((admin) => {
    const userId = String(admin.id ?? admin._id);
    return createNotification({
      ...input,
      userId,
      recipientType: "admin",
    });
  });

  return Promise.all(promises);
}

/** Opens a same-origin Server-Sent Events connection for one authenticated user. */
export function subscribeToNotifications(userId: string, response: Response) {
  response.status(200);
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  response.write("retry: 10000\n\n");

  const userSubscribers = subscribers.get(userId) ?? new Set<Response>();
  userSubscribers.add(response);
  subscribers.set(userId, userSubscribers);

  const heartbeat = setInterval(() => {
    try {
      response.write(": keep-alive\n\n");
    } catch {
      // The close handler below performs the same cleanup.
    }
  }, 25000);

  response.on("close", () => {
    clearInterval(heartbeat);
    userSubscribers.delete(response);
    if (userSubscribers.size === 0) subscribers.delete(userId);
  });
}

export type { NotificationType, NotificationCategory, NotificationPriority, NotificationSource, RecipientType };
