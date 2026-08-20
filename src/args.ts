import type { ParsedArgs } from "./types";

const VALUE_FLAGS = new Set([
  "api-url", "token", "person", "birthday", "sex", "name", "shichen", "time", "city",
  "lng", "lat", "ages", "year", "month", "dayun", "report", "report-2", "report-type",
  "question", "mode", "method", "number1", "number2", "model", "session", "mirror-type",
  "combine-type", "relationship", "name-1", "name-2", "type", "format", "cursor",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]!;
    if (!part.startsWith("--")) {
      positionals.push(part);
      continue;
    }
    const equalAt = part.indexOf("=");
    if (equalAt > 2) {
      flags[part.slice(2, equalAt)] = part.slice(equalAt + 1);
      continue;
    }
    const key = part.slice(2);
    if (VALUE_FLAGS.has(key)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`参数 --${key} 缺少值`);
      flags[key] = value;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positionals, flags };
}

export function stringFlag(args: ParsedArgs, name: string): string {
  const value = args.flags[name];
  return typeof value === "string" ? value.trim() : "";
}

export function booleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}

export function numberFlag(args: ParsedArgs, name: string): number | undefined {
  const value = stringFlag(args, name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} 必须是数字`);
  return parsed;
}
