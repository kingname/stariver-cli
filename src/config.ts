import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StariverConfig {
  token?: string;
  apiUrl?: string;
}

export const DEFAULT_API_URL = "https://api.stariver.me";

export function configPath(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Stariver", "config.json");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "stariver", "config.json");
}

export function loadConfig(): StariverConfig {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8")) as StariverConfig;
  } catch {
    return {};
  }
}

export function saveConfig(next: StariverConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

export function clearConfig(): void {
  rmSync(configPath(), { force: true });
}

export function resolveToken(explicit = ""): string {
  return explicit || process.env.STARIVER_TOKEN || loadConfig().token || "";
}

export function resolveApiUrl(explicit = ""): string {
  return (explicit || process.env.STARIVER_API_URL || loadConfig().apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
}
