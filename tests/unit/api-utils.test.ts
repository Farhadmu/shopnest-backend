import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../../src/utils/api-error";
import { sendSuccess, sendPaginated } from "../../src/utils/api-response";
import { Response } from "express";

function createMockResponse() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("ApiError", () => {
  it("creates badRequest error with 400", () => {
    const err = ApiError.badRequest("Invalid payload");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Invalid payload");
    expect(err.isOperational).toBe(true);
  });

  it("creates unauthorized error with 401", () => {
    const err = ApiError.unauthorized("Login required");
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe("Login required");
  });

  it("creates forbidden error with 403", () => {
    const err = ApiError.forbidden("Access denied");
    expect(err.statusCode).toBe(403);
  });

  it("creates notFound error with 404", () => {
    const err = ApiError.notFound("User not found");
    expect(err.statusCode).toBe(404);
  });
});

describe("sendSuccess & sendPaginated", () => {
  it("sends object data formatted correctly", () => {
    const res = createMockResponse();
    sendSuccess(res, { id: "123", name: "Shop" }, "Fetched successfully");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Fetched successfully",
      id: "123",
      name: "Shop",
    });
  });

  it("sends array data as raw array for frontend contract compatibility", () => {
    const res = createMockResponse();
    sendSuccess(res, [{ id: "1" }, { id: "2" }]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ id: "1" }, { id: "2" }]);
  });

  it("sends paginated data correctly", () => {
    const res = createMockResponse();
    sendPaginated(res, [{ id: "1" }], 10, 1, 5, "Paginated items");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Paginated items",
      items: [{ id: "1" }],
      total: 10,
      page: 1,
      limit: 5,
      totalPages: 2,
    });
  });
});
