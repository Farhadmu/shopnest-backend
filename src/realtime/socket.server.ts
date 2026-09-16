import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import {
  AuthUser,
  resolveUserFromSessionToken,
  verifySignedToken,
} from "../middlewares/auth.middleware";
import { DeliveryRequest } from "../modules/delivery/delivery-request.model";
import { DeliveryManDetails } from "../modules/delivery/delivery-man.model";
import { DeliveryLocation } from "../modules/delivery/delivery-location.model";
import { isValidCoordinate, calculateDistanceMeters, getApproxCoordinatesFromAddress } from "../utils/geo";
import { createNotification } from "../modules/notifications/notification.service";

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthUser;
    lastBreadcrumbAt?: number;
    geofenceState?: {
      pickupNotified?: boolean;
      dropoffNotified?: boolean;
    };
  };
}

let ioInstance: SocketIOServer | null = null;

// Throttling interval for persistent DB breadcrumb writes (every 10 seconds)
const BREADCRUMB_THROTTLE_MS = 10_000;

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: [
        ...(Array.isArray(env.CORS_ORIGIN_LIST) ? env.CORS_ORIGIN_LIST : []),
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ],
      credentials: true,
      methods: ["GET", "POST", "PATCH"],
    },
    pingInterval: 25000,
    pingTimeout: 20000,
    transports: ["websocket", "polling"],
  });

  ioInstance = io;

  // ─── Socket Authentication Middleware ───────────────────────────────────────
  io.use(async (socket: Socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      const headers = socket.handshake.headers || {};

      let rawToken: string | null = null;

      if (typeof auth.token === "string" && auth.token) {
        rawToken = auth.token;
      } else if (typeof headers.authorization === "string" && headers.authorization.startsWith("Bearer ")) {
        rawToken = headers.authorization.slice(7).trim();
      } else if (typeof headers.cookie === "string" && headers.cookie) {
        const cookieNames = [
          env.BETTER_AUTH_COOKIE_NAME,
          "better-auth.session_token",
          "__Secure-better-auth.session_token",
        ];
        for (const name of cookieNames) {
          const match = headers.cookie
            .split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith(`${name}=`));
          if (match) {
            rawToken = decodeURIComponent(match.split("=").slice(1).join("="));
            break;
          }
        }
      }

      // Dev override header
      if (!env.IS_PROD && headers["x-debug-user-id"]) {
        (socket as AuthenticatedSocket).data.user = {
          id: String(headers["x-debug-user-id"]),
          email: String(headers["x-debug-user-email"] || "debug@shopnest.local"),
          name: String(headers["x-debug-user-name"] || "Debug User"),
          role: (headers["x-debug-user-role"] as AuthUser["role"]) || "customer",
        };
        return next();
      }

      if (!rawToken) {
        // Unauthenticated socket connection (allows anonymous tracking only if explicitly granted, otherwise reject)
        return next(new Error("Authentication token required"));
      }

      const decodedToken = verifySignedToken(rawToken) || rawToken;
      const user = await resolveUserFromSessionToken(decodedToken);

      if (!user) {
        return next(new Error("Invalid or expired session"));
      }

      (socket as AuthenticatedSocket).data.user = user;
      next();
    } catch (err) {
      logger.error("Socket authentication error", err);
      next(new Error("Socket authentication failed"));
    }
  });

  // ─── Connection & Event Handlers ───────────────────────────────────────────
  io.on("connection", (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;
    const user = authSocket.data.user;

    logger.info(`[Socket.IO] Client connected: socketId=${socket.id}, user=${user?.id} (${user?.role})`);

    // 1. Join user private channel
    if (user?.id) {
      socket.join(`user:${user.id}`);
      if (user.role === "delivery_man") {
        socket.join(`rider:${user.id}`);
      }
    }

    // 2. Join Delivery Room with Strict Verification
    socket.on(
      "join:delivery",
      async (
        payload: { deliveryId?: string; orderId?: string },
        callback?: (res: { success: boolean; message?: string }) => void
      ) => {
        try {
          if (!user) {
            callback?.({ success: false, message: "Authentication required" });
            return;
          }

          const query: Record<string, unknown> = {};
          if (payload.deliveryId) query._id = payload.deliveryId;
          else if (payload.orderId) query.orderId = payload.orderId;
          else {
            callback?.({ success: false, message: "deliveryId or orderId required" });
            return;
          }

          const delivery = await DeliveryRequest.findOne(query).lean();
          if (!delivery) {
            callback?.({ success: false, message: "Delivery not found" });
            return;
          }

          const isCustomer = delivery.customerId === user.id;
          const isRider = delivery.assignedDeliveryManId === user.id;
          const isSeller = delivery.sellerId === user.id;
          const isAdmin = user.role === "admin";

          if (!isCustomer && !isRider && !isSeller && !isAdmin) {
            callback?.({ success: false, message: "Unauthorized to track this delivery" });
            return;
          }

          const roomName = `delivery:${delivery._id}`;
          socket.join(roomName);
          logger.info(`[Socket.IO] User ${user.id} joined ${roomName}`);
          callback?.({ success: true, message: `Joined ${roomName}` });
        } catch (err: any) {
          logger.error("Error joining delivery room", err);
          callback?.({ success: false, message: err?.message || "Failed to join room" });
        }
      }
    );

    // 3. Leave Delivery Room
    socket.on("leave:delivery", (payload: { deliveryId: string }) => {
      if (payload?.deliveryId) {
        socket.leave(`delivery:${payload.deliveryId}`);
      }
    });

    // 4. Join Admin Operations Room
    socket.on(
      "join:admin_operations",
      (callback?: (res: { success: boolean; message?: string }) => void) => {
        if (user?.role !== "admin") {
          callback?.({ success: false, message: "Requires ADMIN role" });
          return;
        }
        socket.join("admin:operations");
        callback?.({ success: true });
      }
    );

    // 5. Realtime Live GPS Broadcast Event from Delivery Man
    socket.on(
      "location:update",
      async (
        payload: {
          latitude: number;
          longitude: number;
          accuracy?: number;
          altitude?: number;
          speed?: number;
          heading?: number;
          deliveryRequestId?: string;
          timestamp?: number | string;
        },
        callback?: (res: { success: boolean; message?: string }) => void
      ) => {
        try {
          if (!user || (user.role !== "delivery_man" && user.role !== "admin")) {
            callback?.({ success: false, message: "Only delivery partners can broadcast location" });
            return;
          }

          const { latitude, longitude, accuracy, altitude, speed, heading, deliveryRequestId } = payload;

          if (!isValidCoordinate(latitude, longitude)) {
            callback?.({ success: false, message: "Invalid GPS coordinates" });
            return;
          }

          const now = new Date();

          // Update rider's current operational location in DeliveryManDetails
          await DeliveryManDetails.findOneAndUpdate(
            { userId: user.id },
            {
              $set: {
                isActive: true,
                lastActiveAt: now,
                "currentLocation.latitude": latitude,
                "currentLocation.longitude": longitude,
                "currentLocation.updatedAt": now,
              },
            },
            { upsert: true }
          );

          // Broadcast to Admin Operations Center
          io.to("admin:operations").emit("admin:rider_location", {
            riderId: user.id,
            riderName: user.name,
            latitude,
            longitude,
            accuracy,
            speed,
            heading,
            deliveryRequestId,
            updatedAt: now.toISOString(),
          });

          // If bound to an active delivery mission
          if (deliveryRequestId) {
            const activeReq = await DeliveryRequest.findOne({
              _id: deliveryRequestId,
              assignedDeliveryManId: user.id,
              status: { $in: ["picked_up", "in_transit", "out_for_delivery"] },
            });

            if (activeReq) {
              const deliveryRoom = `delivery:${activeReq._id}`;

              // Sanitize location payload for customer/seller (no private identifiers)
              const liveLocationPayload = {
                deliveryId: activeReq.id,
                orderId: activeReq.orderId,
                latitude,
                longitude,
                accuracy,
                speed,
                heading,
                status: activeReq.status,
                updatedAt: now.toISOString(),
              };

              io.to(deliveryRoom).emit("delivery:location_update", liveLocationPayload);

              // ─── Geofencing Telemetry Check ───────────────────────────────
              if (!authSocket.data.geofenceState) {
                authSocket.data.geofenceState = {};
              }

              // Check dropoff destination geofence (~250m approaching radius)
              const dropCoords = getApproxCoordinatesFromAddress(activeReq.deliveryAddress);
              if (dropCoords && !authSocket.data.geofenceState.dropoffNotified) {
                const distToDrop = calculateDistanceMeters(
                  latitude,
                  longitude,
                  dropCoords.latitude,
                  dropCoords.longitude
                );
                if (distToDrop <= 250) {
                  authSocket.data.geofenceState.dropoffNotified = true;
                  io.to(deliveryRoom).emit("geofence:approaching_customer", {
                    deliveryId: activeReq.id,
                    orderId: activeReq.orderId,
                    distanceMeters: distToDrop,
                    message: "Courier is approaching your delivery destination!",
                  });

                  createNotification({
                    userId: activeReq.customerId,
                    type: "delivery_alert",
                    category: "delivery",
                    priority: "info",
                    source: "delivery",
                    title: "Courier is Nearby",
                    message: `Your courier is within 250m of your delivery address for order #${activeReq.orderId}. Please be ready with your OTP.`,
                    link: `/orders/${activeReq.orderId}`,
                    relatedId: activeReq.orderId,
                    relatedType: "order",
                  }).catch(() => undefined);
                }
              }

              // Throttled Breadcrumb History in DB
              const lastBreadcrumb = authSocket.data.lastBreadcrumbAt || 0;
              if (Date.now() - lastBreadcrumb > BREADCRUMB_THROTTLE_MS) {
                authSocket.data.lastBreadcrumbAt = Date.now();
                await DeliveryLocation.create({
                  deliveryRequestId: activeReq.id,
                  deliveryManId: user.id,
                  latitude,
                  longitude,
                  accuracy,
                  altitude,
                  speed,
                  heading,
                  recordedAt: now,
                });
              }
            }
          }

          callback?.({ success: true });
        } catch (err: any) {
          logger.error("location:update handler error", err);
          callback?.({ success: false, message: err?.message || "Location processing failed" });
        }
      }
    );

    socket.on("disconnect", (reason) => {
      logger.info(`[Socket.IO] Client disconnected: socketId=${socket.id}, reason=${reason}`);
    });
  });

  logger.info("[Socket.IO] Realtime server initialized successfully");
  return io;
}

/** Get the initialized Socket.IO instance */
export function getIO(): SocketIOServer | null {
  return ioInstance;
}

/** Broadcast event to a specific delivery room */
export function emitDeliveryEvent(deliveryId: string, event: string, data: Record<string, unknown>): void {
  if (ioInstance) {
    ioInstance.to(`delivery:${deliveryId}`).emit(event, data);
  }
}

/** Broadcast event to admin operations */
export function emitAdminOperationsEvent(event: string, data: Record<string, unknown>): void {
  if (ioInstance) {
    ioInstance.to("admin:operations").emit(event, data);
  }
}
