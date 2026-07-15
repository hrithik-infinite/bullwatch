import { describe, expect, it } from "vitest";
import { errorSignature } from "./error-signature.js";

describe("errorSignature", () => {
  it("returns null for empty input", () => {
    expect(errorSignature(null)).toBeNull();
    expect(errorSignature(undefined)).toBeNull();
    expect(errorSignature("   ")).toBeNull();
  });

  it("replaces numbers so timeouts of different lengths group together", () => {
    const a = errorSignature("Timeout of 5000ms exceeded");
    const b = errorSignature("Timeout of 3000ms exceeded");
    expect(a).toBe("Timeout of <n>ms exceeded");
    expect(a).toBe(b);
  });

  it("normalizes UUIDs", () => {
    expect(errorSignature("Job 3f2504e0-4f89-11d3-9a0c-0305e82c3301 not found")).toBe(
      "Job <uuid> not found",
    );
  });

  it("normalizes quoted strings", () => {
    expect(errorSignature('duplicate key violates unique constraint "users_email_key"')).toBe(
      "duplicate key violates unique constraint <str>",
    );
  });

  it("normalizes URLs and emails", () => {
    expect(errorSignature("connect ECONNREFUSED https://api.stripe.com/v1/charges")).toBe(
      "connect ECONNREFUSED <url>",
    );
    expect(errorSignature("no mailbox for user@example.com")).toBe("no mailbox for <email>");
  });

  it("normalizes file paths with line/column", () => {
    expect(errorSignature("boom at /app/src/worker.js:12:5")).toBe("boom at <path>");
  });

  it("keeps only the first line of a stack trace", () => {
    const sig = errorSignature("TypeError: x is not a function\n    at foo (/app/a.js:1:1)");
    expect(sig).toBe("TypeError: x is not a function");
  });

  it("caps length so a signature is always a safe dimension label", () => {
    const sig = errorSignature("e ".repeat(500)) as string;
    expect(sig.length).toBeLessThanOrEqual(200);
  });
});
