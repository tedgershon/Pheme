import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type ApiErrorBody,
  listMarkets,
  parseApiError,
} from "../api";

vi.mock("../supabase", () => ({ supabase: null }));

describe("ApiError", () => {
  it("uses a safe message for legacy plain-text responses", () => {
    const error = new ApiError(500, "Internal server error.");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.status).toBe(500);
    expect(error.code).toBe("UNKNOWN");
    expect(error.userMessage).toBe("Request failed (500).");
    expect(error.message).toBe(error.userMessage);
    expect(error.fieldErrors).toEqual([]);
    expect(error.raw).toBe("Internal server error.");
    expect(error.body).toBe(error.raw);
  });

  it("exposes the envelope message to existing Error.message readers", () => {
    const detail: ApiErrorBody = {
      code: "BET_INSUFFICIENT_BALANCE",
      message: "Not enough.",
    };
    const raw = JSON.stringify({ detail });
    const error = new ApiError(409, raw);

    expect(error.code).toBe(detail.code);
    expect(error.userMessage).toBe(detail.message);
    expect(error.message).toBe(detail.message);
    expect(error.fieldErrors).toEqual([]);
    expect(error.raw).toBe(raw);
    expect(error.body).toBe(raw);
  });

  it("extracts validation fields including nested option paths", () => {
    const detail: ApiErrorBody = {
      code: "VALIDATION_FAILED",
      message: "Validation failed.",
      errors: [
        { field: "title", message: "required", type: "missing" },
        {
          field: "options.2.label",
          message: "Label is too long.",
          type: "value_error",
        },
      ],
    };
    const error = new ApiError(422, JSON.stringify({ detail }));

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toBe("Validation failed.");
    expect(error.fieldErrors).toEqual([
      { field: "title", message: "required" },
      { field: "options.2.label", message: "Label is too long." },
    ]);
  });

  it.each([
    "",
    "<html>Proxy error</html>",
    '{"detail":',
    "null",
    "42",
    "true",
    '"Internal server error."',
    "[]",
    "{}",
    '{"detail":"private database error"}',
    '{"detail":null}',
    '{"detail":[]}',
    '{"detail":{"code":5,"message":"private database error"}}',
    '{"detail":{"code":"INTERNAL_ERROR","message":{}}}',
    '{"detail":{"message":"private database error"}}',
  ])("falls back without throwing or exposing malformed body %j", (raw) => {
    const error = new ApiError(500, raw);

    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe("Request failed (500).");
    expect(error.userMessage).toBe(error.message);
    expect(error.fieldErrors).toEqual([]);
    expect(error.raw).toBe(raw);
  });

  it.each([null, "invalid", {}, 42])(
    "ignores a malformed errors collection %j without losing the message",
    (errors) => {
      const error = new ApiError(
        422,
        JSON.stringify({
          detail: {
            code: "VALIDATION_FAILED",
            message: "Validation failed.",
            errors,
          },
        }),
      );

      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.message).toBe("Validation failed.");
      expect(error.fieldErrors).toEqual([]);
    },
  );

  it("keeps valid field errors and skips malformed entries", () => {
    const error = new ApiError(
      422,
      JSON.stringify({
        detail: {
          code: "VALIDATION_FAILED",
          message: "Validation failed.",
          errors: [
            null,
            "invalid",
            {},
            { field: 1, message: "invalid" },
            { field: "title", message: {} },
            { field: "title", message: "required", type: "missing" },
          ],
        },
      }),
    );

    expect(error.fieldErrors).toEqual([
      { field: "title", message: "required" },
    ]);
  });
});

describe("parseApiError", () => {
  it("returns the structured fields from an ApiError", () => {
    const error = new ApiError(
      422,
      JSON.stringify({
        detail: {
          code: "VALIDATION_FAILED",
          message: "Validation failed.",
          errors: [{ field: "title", message: "required", type: "missing" }],
        },
      }),
    );

    expect(parseApiError(error, "Fallback.")).toEqual({
      code: "VALIDATION_FAILED",
      message: "Validation failed.",
      fieldErrors: [{ field: "title", message: "required" }],
    });
  });

  it("uses the safe status message for a legacy ApiError", () => {
    expect(parseApiError(new ApiError(500, "private database error"))).toEqual({
      code: "UNKNOWN",
      message: "Request failed (500).",
      fieldErrors: [],
    });
  });

  it.each([
    Object.assign(new Error("private cancellation details"), {
      name: "AbortError",
    }),
    new DOMException("The operation was aborted.", "AbortError"),
  ])("normalizes an AbortError", (error) => {
    expect(parseApiError(error)).toEqual({
      code: "ABORTED",
      message: "Request cancelled.",
      fieldErrors: [],
    });
  });

  it.each(["Failed to fetch", "fetch failed", "FETCH failed"])(
    "normalizes a network TypeError: %s",
    (message) => {
      expect(parseApiError(new TypeError(message))).toEqual({
        code: "NETWORK_ERROR",
        message: "Connection failed. Check your internet.",
        fieldErrors: [],
      });
    },
  );

  it.each([
    new Error("private database error"),
    new Error("fetch failed"),
    new TypeError("Cannot read properties of undefined"),
    "private database error",
    { message: "private database error" },
    null,
    undefined,
  ])("uses the supplied fallback for an unknown error", (error) => {
    expect(parseApiError(error, "Failed to create market.")).toEqual({
      code: "UNKNOWN",
      message: "Failed to create market.",
      fieldErrors: [],
    });
  });

  it("provides a default fallback", () => {
    expect(parseApiError(undefined)).toEqual({
      code: "UNKNOWN",
      message: "Something went wrong.",
      fieldErrors: [],
    });
  });
});

describe("ApiError through the fetch helper", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("surfaces an envelope message through an existing API call", async () => {
    const raw = JSON.stringify({
      detail: { code: "INTERNAL_ERROR", message: "Please try again." },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(raw, { status: 500 })),
    );

    await expect(listMarkets()).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Please try again.",
      body: raw,
      raw,
    });
  });

  it("keeps successful API responses unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("[]", { status: 200 })),
    );

    await expect(listMarkets()).resolves.toEqual([]);
  });
});
