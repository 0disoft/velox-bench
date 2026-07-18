import { describe, expect, test } from "bun:test";
import { exactCacheRecord, isDeleteSuccessStatus } from "./cache-api";

describe("GitHub cache API evidence", () => {
  test("selects one exact key and ref", () => {
    const record = exactCacheRecord({ actions_caches: [{ id: 7, key: "k", ref: "refs/heads/main", size_in_bytes: 42, created_at: "2026-07-18T00:00:00Z" }] }, "k", "refs/heads/main");
    expect(record).toEqual({ id: 7, key: "k", ref: "refs/heads/main", sizeBytes: 42, createdAtUtc: "2026-07-18T00:00:00Z" });
  });

  test("rejects ambiguous cache records", () => {
    const payload = { actions_caches: [
      { id: 7, key: "k", ref: "refs/heads/main", size_in_bytes: 42, created_at: "2026-07-18T00:00:00Z" },
      { id: 8, key: "k", ref: "refs/heads/main", size_in_bytes: 43, created_at: "2026-07-18T00:00:01Z" },
    ] };
    expect(() => exactCacheRecord(payload, "k", "refs/heads/main")).toThrow("expected one exact cache");
  });

  test("accepts successful and idempotent cache deletion statuses", () => {
    expect(isDeleteSuccessStatus(200)).toBe(true);
    expect(isDeleteSuccessStatus(204)).toBe(true);
    expect(isDeleteSuccessStatus(404)).toBe(true);
    expect(isDeleteSuccessStatus(403)).toBe(false);
    expect(isDeleteSuccessStatus(500)).toBe(false);
  });
});
