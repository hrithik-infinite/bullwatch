import { describe, expect, it } from "vitest";
import { matchesQuery, parseSearchQuery } from "./search-query.js";

describe("parseSearchQuery", () => {
  it("splits field:value predicates from free-text terms", () => {
    const q = parseSearchQuery("status:failed order-4711");
    expect(q.fields).toEqual([{ path: "status", value: "failed" }]);
    expect(q.terms).toEqual(["order-4711"]);
  });

  it("keeps quoted values and phrases intact", () => {
    const q = parseSearchQuery('name:"send email" "hello world"');
    expect(q.fields).toEqual([{ path: "name", value: "send email" }]);
    expect(q.terms).toEqual(["hello world"]);
  });

  it("does not mistake a bare URL for a field predicate", () => {
    const q = parseSearchQuery("https://api.stripe.com");
    expect(q.fields).toEqual([]);
    expect(q.terms).toEqual(["https://api.stripe.com"]);
  });
});

describe("matchesQuery", () => {
  const job = {
    id: "42",
    name: "email",
    data: { userId: 4711, email: "a@b.com", customer: { id: "c_1" } },
  };

  it("matches free text against id, name, and payload (case-insensitive)", () => {
    expect(matchesQuery(job, parseSearchQuery("EMAIL"))).toBe(true);
    expect(matchesQuery(job, parseSearchQuery("4711"))).toBe(true);
    expect(matchesQuery(job, parseSearchQuery("nope"))).toBe(false);
  });

  it("matches job-level id and name fields", () => {
    expect(matchesQuery(job, parseSearchQuery("id:42"))).toBe(true);
    expect(matchesQuery(job, parseSearchQuery("name:mail"))).toBe(true);
    expect(matchesQuery(job, parseSearchQuery("id:99"))).toBe(false);
  });

  it("resolves dotted paths into the payload", () => {
    expect(matchesQuery(job, parseSearchQuery("email:a@b"))).toBe(true);
    expect(matchesQuery(job, parseSearchQuery("customer.id:c_1"))).toBe(true);
    expect(matchesQuery(job, parseSearchQuery("customer.id:zzz"))).toBe(false);
  });

  it("ANDs all predicates and terms together", () => {
    expect(matchesQuery(job, parseSearchQuery("name:email userId:4711"))).toBe(true);
    expect(matchesQuery(job, parseSearchQuery("name:email userId:9999"))).toBe(false);
  });

  it("returns false when a path is absent", () => {
    expect(matchesQuery(job, parseSearchQuery("missing.field:x"))).toBe(false);
  });
});
