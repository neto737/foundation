import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createLogger", () => {
  it("writes timestamped structured entries with merged context", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:34:56.000Z"));
    const write = vi.fn();
    const logger = createLogger(
      { write },
      { requestId: "request-1", route: "/health" },
    );

    logger.info("request completed", { durationMs: 12, route: "/ready" });

    expect(write).toHaveBeenCalledWith({
      durationMs: 12,
      level: "info",
      message: "request completed",
      requestId: "request-1",
      route: "/ready",
      timestamp: "2026-09-16T12:34:56.000Z",
    });
  });

  it("emits every public log level", () => {
    const write = vi.fn();
    const logger = createLogger({ write });

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    expect(write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ level: "debug" }),
    );
    expect(write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ level: "info" }),
    );
    expect(write).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ level: "warn" }),
    );
    expect(write).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ level: "error" }),
    );
  });

  it("redacts sensitive context and protects reserved entry fields", () => {
    const write = vi.fn();
    const logger = createLogger(
      { write },
      {
        authorizationHeader: "Bearer private",
        level: "forged",
        requestId: "request-1",
      },
    );

    logger.warn("safe message", {
      access_token: "private",
      message: "forged",
      sessionCookie: "private",
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "[REDACTED]",
        authorizationHeader: "[REDACTED]",
        level: "warn",
        message: "safe message",
        requestId: "request-1",
        sessionCookie: "[REDACTED]",
      }),
    );
  });
});
