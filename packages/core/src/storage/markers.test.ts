import { describe, expect, it } from "vitest";
import {
  InvalidMarkerError,
  MAX_MARKER_METADATA_KEYS,
  MAX_MARKER_METADATA_VALUE_LENGTH,
  assertMarkerPersistable,
  createMarker,
  markerMatchesQueue,
} from "./markers.js";

describe("createMarker", () => {
  it("assigns an id, defaults ts to now, and normalizes optional fields", () => {
    const m = createMarker({ label: "deploy v1.2.3" }, 1_000);
    expect(m.id).toMatch(/[0-9a-f-]{36}/);
    expect(m.ts).toBe(1_000);
    expect(m.label).toBe("deploy v1.2.3");
    expect(m.version).toBeNull();
    expect(m.sha).toBeNull();
    expect(m.queue).toBeNull();
    expect(m.metadata).toBeNull();
  });

  it("keeps supplied ts, version, sha, queue, and metadata", () => {
    const m = createMarker(
      {
        ts: 42,
        label: "rel",
        version: "1.2.3",
        sha: "abc123",
        queue: "email",
        metadata: { by: "ci" },
      },
      1_000,
    );
    expect(m.ts).toBe(42);
    expect(m.version).toBe("1.2.3");
    expect(m.queue).toBe("email");
    expect(m.metadata).toEqual({ by: "ci" });
  });

  it("drops empty metadata to null", () => {
    expect(createMarker({ label: "x", metadata: {} }, 0).metadata).toBeNull();
  });

  it("rejects an empty label", () => {
    expect(() => createMarker({ label: "" }, 0)).toThrow(InvalidMarkerError);
  });
});

describe("assertMarkerPersistable", () => {
  const base = createMarker({ label: "ok" }, 0);

  it("rejects an oversized label (payload leak guard)", () => {
    expect(() => createMarker({ label: "x".repeat(300) }, 0)).toThrow(InvalidMarkerError);
  });

  it("rejects too many metadata keys", () => {
    const metadata: Record<string, string> = {};
    for (let i = 0; i <= MAX_MARKER_METADATA_KEYS; i++) metadata[`k${i}`] = "v";
    expect(() => createMarker({ label: "x", metadata }, 0)).toThrow(InvalidMarkerError);
  });

  it("rejects an oversized metadata value", () => {
    expect(() =>
      createMarker(
        { label: "x", metadata: { big: "y".repeat(MAX_MARKER_METADATA_VALUE_LENGTH + 1) } },
        0,
      ),
    ).toThrow(InvalidMarkerError);
  });

  it("rejects a negative ts", () => {
    expect(() => assertMarkerPersistable({ ...base, ts: -1 })).toThrow(InvalidMarkerError);
  });
});

describe("markerMatchesQueue", () => {
  const global = createMarker({ label: "g" }, 0);
  const scoped = createMarker({ label: "s", queue: "email" }, 0);

  it("matches everything when no queue filter is given", () => {
    expect(markerMatchesQueue(global, undefined)).toBe(true);
    expect(markerMatchesQueue(scoped, undefined)).toBe(true);
  });

  it("returns global markers plus that queue's when filtered", () => {
    expect(markerMatchesQueue(global, "email")).toBe(true);
    expect(markerMatchesQueue(scoped, "email")).toBe(true);
    expect(markerMatchesQueue(scoped, "billing")).toBe(false);
  });
});
