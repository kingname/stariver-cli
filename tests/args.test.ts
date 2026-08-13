import { describe, expect, test } from "bun:test";
import { booleanFlag, numberFlag, parseArgs, stringFlag } from "../src/args";

describe("参数解析", () => {
  test("解析子命令、值参数和布尔参数", () => {
    const args = parseArgs(["ziwei", "liuyue", "--person", "p1", "--year=2026", "--month", "8", "--json", "--no-wait"]);
    expect(args.positionals).toEqual(["ziwei", "liuyue"]);
    expect(stringFlag(args, "person")).toBe("p1");
    expect(numberFlag(args, "year")).toBe(2026);
    expect(numberFlag(args, "month")).toBe(8);
    expect(booleanFlag(args, "json")).toBe(true);
    expect(booleanFlag(args, "no-wait")).toBe(true);
  });

  test("值参数缺失时直接失败", () => {
    expect(() => parseArgs(["explain", "--report"])).toThrow("缺少值");
  });
});
