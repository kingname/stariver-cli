import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { JsonObject } from "./types";

export function isInteractive(jsonMode: boolean): boolean {
  return !jsonMode && Boolean(stdin.isTTY && stdout.isTTY);
}

export async function ask(label: string, current = ""): Promise<string> {
  if (current) return current;
  const rl = createInterface({ input: stdin, output: stdout });
  try { return (await rl.question(`${label}: `)).trim(); } finally { rl.close(); }
}

export async function choose<T>(label: string, items: T[], render: (item: T) => string): Promise<T> {
  if (!items.length) throw new Error(`${label}没有可选项`);
  if (!stdin.isTTY) throw new Error(`${label}需要通过参数明确指定`);
  console.error(label);
  items.forEach((item, index) => console.error(`  ${index + 1}. ${render(item)}`));
  const answer = await ask("请输入序号");
  const selected = items[Number(answer) - 1];
  if (!selected) throw new Error("选择无效");
  return selected;
}

export function output(value: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

export function eventChunk(data: string): string {
  try {
    const parsed = JSON.parse(data) as JsonObject;
    return typeof parsed.chunk === "string" ? parsed.chunk : "";
  } catch {
    return data;
  }
}
