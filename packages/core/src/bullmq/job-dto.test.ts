import { describe, expect, it } from "vitest";
import { type JobLike, toJobDTO } from "./job-dto.js";

const completed: JobLike = {
  id: "1",
  name: "welcome",
  attemptsMade: 1,
  timestamp: 1_000,
  processedOn: 1_500,
  finishedOn: 2_500,
  data: { userId: 42 },
  opts: { attempts: 3 },
  returnvalue: { sent: true },
  failedReason: undefined,
  stacktrace: [],
  progress: 100,
  parentKey: undefined,
};

describe("toJobDTO", () => {
  it("maps core fields and derives timings", () => {
    const dto = toJobDTO(completed, "email", 3_000);
    expect(dto).toMatchObject({
      id: "1",
      name: "welcome",
      queue: "email",
      attemptsMade: 1,
      data: { userId: 42 },
      timings: { waitMs: 500, runMs: 1_000, totalMs: 1_500 },
    });
  });

  it("computes an error signature for failed jobs", () => {
    const dto = toJobDTO(
      { ...completed, failedReason: "Timeout of 5000ms exceeded", returnvalue: undefined },
      "email",
      3_000,
    );
    expect(dto.failedReason).toBe("Timeout of 5000ms exceeded");
    expect(dto.errorSignature).toBe("Timeout of <n>ms exceeded");
  });

  it("normalizes null signature and empty stacktrace when there is no failure", () => {
    const dto = toJobDTO(completed, "email", 3_000);
    expect(dto.errorSignature).toBeNull();
    expect(dto.stacktrace).toEqual([]);
  });

  it("tolerates a null id", () => {
    const dto = toJobDTO({ ...completed, id: undefined }, "email", 3_000);
    expect(dto.id).toBeNull();
  });
});
