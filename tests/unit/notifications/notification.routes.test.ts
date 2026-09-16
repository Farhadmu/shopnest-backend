import { describe, it, expect, vi } from "vitest";

// The middleware/controllers pull in the DB layer and env config; stub them so
// this stays a pure wiring test of the router itself.
vi.mock("../../../src/middlewares/auth.middleware", () => {
  // `requireAuth` is spread into router.use(...), so it must be a non-empty array.
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    requireAuth: [passThrough],
    attachUserIfPresent: passThrough,
  };
});

vi.mock("../../../src/middlewares/role.middleware", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../../src/modules/notifications/notification.controller", () => {
  const handler = () => vi.fn();
  return {
    listNotifications: handler(),
    unreadCount: handler(),
    markAllRead: handler(),
    markRead: handler(),
    clearReadNotifications: handler(),
    deleteNotification: handler(),
    listAdminNotifications: handler(),
    getAdminNotificationStats: handler(),
    getAdminUnreadCount: handler(),
    markAllAdminNotificationsRead: handler(),
    bulkMarkAdminNotificationsRead: handler(),
    markAdminNotificationRead: handler(),
    markAdminNotificationUnread: handler(),
  };
});

import router, { adminRouter } from "../../../src/modules/notifications/notification.routes";

type RouteLayer = { route?: { path: string; methods: Record<string, boolean> } };

/** Registered paths for one HTTP method, in registration order. */
function pathsFor(target: unknown, method: string): string[] {
  const stack = (target as { stack?: RouteLayer[] }).stack ?? [];
  return stack
    .filter((layer) => layer.route?.methods?.[method])
    .map((layer) => layer.route!.path);
}

describe("notification route registration order", () => {
  // Regression: `DELETE /clear-read` used to be registered after `DELETE /:id`,
  // so Express captured it as `/:id` with id="clear-read" and the handler threw
  // a BSONError (500) when converting that string to an ObjectId.
  it("registers DELETE /clear-read before the DELETE /:id catch-all", () => {
    const deletes = pathsFor(router, "delete");

    const staticIndex = deletes.indexOf("/clear-read");
    const paramIndex = deletes.indexOf("/:id");

    expect(staticIndex).toBeGreaterThanOrEqual(0);
    expect(paramIndex).toBeGreaterThanOrEqual(0);
    expect(staticIndex).toBeLessThan(paramIndex);
  });

  it("keeps the customer notification routes wired up", () => {
    expect(pathsFor(router, "get")).toEqual(["/", "/unread-count"]);
    expect(pathsFor(router, "patch")).toEqual(["/read-all", "/:id/read"]);
    expect(pathsFor(router, "delete")).toEqual(["/clear-read", "/:id"]);
  });

  it("keeps the admin notification routes wired up", () => {
    expect(pathsFor(adminRouter, "get")).toEqual(["/", "/stats", "/unread-count"]);
    // Static admin actions must precede the /:id/... routes for the same reason.
    expect(pathsFor(adminRouter, "patch")).toEqual([
      "/read-all",
      "/bulk-read",
      "/:id/read",
      "/:id/unread",
    ]);
  });
});
