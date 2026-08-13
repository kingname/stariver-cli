import { describe, expect, test } from "bun:test";
import { compareVersions } from "../src/update";

describe("版本比较", () => {
  test("按语义版本比较", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("v0.1.1", "0.1.1")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBe(-1);
  });
});
