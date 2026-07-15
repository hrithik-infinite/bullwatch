import { describe, expect, it } from "vitest";
import { metaScanPattern, queueNameFromMetaKey } from "./discovery.js";

describe("queue discovery parsing", () => {
  it("builds the SCAN pattern for a prefix", () => {
    expect(metaScanPattern("bull")).toBe("bull:*:meta");
    expect(metaScanPattern("{bull}")).toBe("{bull}:*:meta");
  });

  it("extracts the queue name from a meta key", () => {
    expect(queueNameFromMetaKey("bull:email:meta", "bull")).toBe("email");
  });

  it("preserves colons inside queue names", () => {
    expect(queueNameFromMetaKey("bull:tenant:1:email:meta", "bull")).toBe("tenant:1:email");
  });

  it("returns null for non-meta keys", () => {
    expect(queueNameFromMetaKey("bull:email:id", "bull")).toBeNull();
    expect(queueNameFromMetaKey("bull:email:metrics:completed", "bull")).toBeNull();
  });

  it("returns null when the prefix does not match", () => {
    expect(queueNameFromMetaKey("other:email:meta", "bull")).toBeNull();
  });

  it("returns null for an empty queue name", () => {
    expect(queueNameFromMetaKey("bull::meta", "bull")).toBeNull();
  });
});
