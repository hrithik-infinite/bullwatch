import { describe, expect, it } from "vitest";
import { MASKED, compileMask } from "../domain/mask.js";
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

  it("withholds payload when includeData is false", () => {
    const dto = toJobDTO(completed, "email", 3_000, { includeData: false });
    expect(dto.data).toBeNull();
    expect(dto.returnvalue).toBeNull();
    expect(dto.dataOmitted).toBe(true);
    // Non-payload fields still present.
    expect(dto.name).toBe("welcome");
    expect(dto.timings.runMs).toBe(1_000);
  });

  it("includes payload by default", () => {
    const dto = toJobDTO(completed, "email", 3_000);
    expect(dto.data).toEqual({ userId: 42 });
    expect(dto.dataOmitted).toBe(false);
  });

  it("redacts masked fields in data and returnvalue", () => {
    const job: JobLike = {
      ...completed,
      data: { userId: 42, password: "hunter2" },
      returnvalue: { token: "abc", ok: true },
    };
    const dto = toJobDTO(job, "email", 3_000, {
      mask: compileMask(["password", "token"]),
    });
    expect(dto.data).toEqual({ userId: 42, password: MASKED });
    expect(dto.returnvalue).toEqual({ token: MASKED, ok: true });
  });

  it("does not render a masked field even though it is withheld anyway", () => {
    // includeData:false already nulls the payload — mask must not resurrect it.
    const dto = toJobDTO(completed, "email", 3_000, {
      includeData: false,
      mask: compileMask(["userId"]),
    });
    expect(dto.data).toBeNull();
  });
});
