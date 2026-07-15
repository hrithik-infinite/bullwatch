import { describe, expect, it } from "vitest";
import { MASKED, applyMask, compileMask } from "./mask.js";

const mask = (value: unknown, patterns: string[]) => applyMask(value, compileMask(patterns));

describe("compileMask", () => {
  it("is inactive with no patterns", () => {
    expect(compileMask([]).active).toBe(false);
    expect(compileMask([""]).active).toBe(false);
  });
});

describe("applyMask", () => {
  it("is identity when inactive", () => {
    const data = { a: 1 };
    expect(applyMask(data, compileMask([]))).toBe(data);
  });

  it("redacts a top-level field", () => {
    expect(mask({ password: "hunter2", user: "ada" }, ["password"])).toEqual({
      password: MASKED,
      user: "ada",
    });
  });

  it("redacts a nested dotted path", () => {
    expect(mask({ user: { ssn: "123", name: "ada" } }, ["user.ssn"])).toEqual({
      user: { ssn: MASKED, name: "ada" },
    });
  });

  it("redacts an entire subtree when the object node is matched", () => {
    expect(mask({ card: { number: "4", cvv: "9" }, id: 1 }, ["card"])).toEqual({
      card: MASKED,
      id: 1,
    });
  });

  it("matches one segment with `*`", () => {
    expect(mask({ a: { secret: "x" }, b: { secret: "y" }, c: "keep" }, ["*.secret"])).toEqual({
      a: { secret: MASKED },
      b: { secret: MASKED },
      c: "keep",
    });
  });

  it("matches any depth with `**`", () => {
    const data = { a: { b: { token: "t1" } }, token: "t2", c: [{ token: "t3" }] };
    expect(mask(data, ["**.token"])).toEqual({
      a: { b: { token: MASKED } },
      token: MASKED,
      c: [{ token: MASKED }],
    });
  });

  it("masks per array element via index wildcard", () => {
    const data = {
      items: [
        { cardNumber: "1", qty: 2 },
        { cardNumber: "3", qty: 4 },
      ],
    };
    expect(mask(data, ["items.*.cardNumber"])).toEqual({
      items: [
        { cardNumber: MASKED, qty: 2 },
        { cardNumber: MASKED, qty: 4 },
      ],
    });
  });

  it("masks a specific array index", () => {
    expect(mask({ items: ["a", "b", "c"] }, ["items.1"])).toEqual({
      items: ["a", MASKED, "c"],
    });
  });

  it("does not mutate the input", () => {
    const data = { user: { ssn: "123" } };
    const out = mask(data, ["user.ssn"]);
    expect(data.user.ssn).toBe("123");
    expect(out).not.toBe(data);
  });

  it("leaves unmatched subtrees referentially shared", () => {
    const keep = { deep: { value: 1 } };
    const out = mask({ keep, secret: "x" }, ["secret"]) as { keep: unknown };
    expect(out.keep).toBe(keep);
  });

  it("passes through primitives and null payloads", () => {
    expect(mask(null, ["a"])).toBe(null);
    expect(mask("plain", ["a"])).toBe("plain");
    expect(mask(42, ["a"])).toBe(42);
  });

  it("applies multiple patterns together", () => {
    expect(
      mask({ password: "p", user: { ssn: "s", name: "n" } }, ["password", "user.ssn"]),
    ).toEqual({ password: MASKED, user: { ssn: MASKED, name: "n" } });
  });
});
