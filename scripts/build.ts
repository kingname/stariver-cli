import { mkdirSync } from "node:fs";
import { join } from "node:path";

const targets = [
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-linux-x64-baseline",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-linux-arm64-musl",
  "bun-windows-x64-baseline",
] as const;

const requested = process.argv[2];
const selected = requested ? targets.filter((target) => target === requested) : targets;
if (!selected.length) throw new Error(`不支持的构建目标：${requested}`);

mkdirSync("dist", { recursive: true });
for (const target of selected) {
  const windows = target.includes("windows");
  const result = await Bun.build({
    entrypoints: ["src/index.ts"],
    compile: {
      target,
      outfile: join("dist", `stariver-${target.replace(/^bun-/, "")}${windows ? ".exe" : ""}`),
      autoloadDotenv: false,
      autoloadBunfig: false,
      autoloadPackageJson: false,
      ...(windows ? { windows: { title: "渡星河 CLI", publisher: "Stariver", version: "0.1.1.0", description: "渡星河命理 CLI" } } : {}),
    },
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, `${target} 构建失败`);
  console.log(`已构建 ${target}`);
}
