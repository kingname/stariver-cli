#!/usr/bin/env bun
import { booleanFlag, parseArgs, stringFlag } from "./args";
import { ApiError, StariverApi } from "./api";
import { resolveApiUrl, resolveToken } from "./config";
import { runCommand } from "./commands";

let json = process.argv.slice(2).includes("--json");

try {
  const args = parseArgs(process.argv.slice(2));
  json = booleanFlag(args, "json");
  const command = booleanFlag(args, "version") ? "version" : args.positionals[0] || "help";
  const token = resolveToken(stringFlag(args, "token"));

  const authAction = args.positionals[1] || "";
  if (!token && !["help", "version"].includes(command) && !(command === "auth" && ["set-token", "logout"].includes(authAction))) {
    throw new Error("尚未安装渡星河登录凭据。请从渡星河网页右上角选择“安装渡星河 CLI”。");
  }
  await runCommand({ args, json, api: new StariverApi(resolveApiUrl(stringFlag(args, "api-url")), token) });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (json) console.log(JSON.stringify({ success: false, error: message, status: error instanceof ApiError ? error.status : undefined }));
  else console.error(`错误：${message}`);
  process.exit(error instanceof ApiError ? 3 : 2);
}
