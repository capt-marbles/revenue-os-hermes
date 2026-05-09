import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";

describe("requireAuth", () => {
  const originalEnv = process.env.OPERATOR_TOKEN;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OPERATOR_TOKEN = originalEnv;
    } else {
      delete process.env.OPERATOR_TOKEN;
    }
  });

  it("allows all requests when no token is configured", () => {
    delete process.env.OPERATOR_TOKEN;
    const req = new NextRequest("http://localhost:3000/api/agents", { method: "POST" });
    expect(requireAuth(req)).toBeNull();
  });

  it("returns 401 when token is configured but not provided", () => {
    process.env.OPERATOR_TOKEN = "secret-123";
    const req = new NextRequest("http://localhost:3000/api/agents", { method: "POST" });
    const res = requireAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("allows request with valid Bearer token", () => {
    process.env.OPERATOR_TOKEN = "secret-123";
    const req = new NextRequest("http://localhost:3000/api/agents", {
      method: "POST",
      headers: { Authorization: "Bearer secret-123" },
    });
    expect(requireAuth(req)).toBeNull();
  });

  it("rejects request with invalid Bearer token", () => {
    process.env.OPERATOR_TOKEN = "secret-123";
    const req = new NextRequest("http://localhost:3000/api/agents", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    const res = requireAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("allows request with valid query param token", () => {
    process.env.OPERATOR_TOKEN = "secret-123";
    const req = new NextRequest("http://localhost:3000/api/scheduler/trigger?token=secret-123", {
      method: "POST",
    });
    expect(requireAuth(req)).toBeNull();
  });

  it("returns 401 with invalid query param token", () => {
    process.env.OPERATOR_TOKEN = "secret-123";
    const req = new NextRequest("http://localhost:3000/api/scheduler/trigger?token=wrong", {
      method: "POST",
    });
    const res = requireAuth(req);
    expect(res).not.toBeNull();
    // No auth header present, so it checks query param, fails, falls through to 401
    expect(res!.status).toBe(401);
  });
});
