import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { REPOSITORY, VERSION } from "./version";

type ReleaseAsset = { name: string; browser_download_url: string };
type LatestRelease = { tag_name: string; assets?: ReleaseAsset[] };

export interface UpdateStatus {
  current_version: string;
  latest_version: string;
  cli_update_available: boolean;
  skill_update_available: boolean;
  update_available: boolean;
  skill_versions: Record<string, string | null>;
  installer_url?: string;
}

function normalizedVersion(value: string): string {
  return value.trim().replace(/^v/, "");
}

export function compareVersions(left: string, right: string): number {
  const a = normalizedVersion(left).split(".").map(Number);
  const b = normalizedVersion(right).split(".").map(Number);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function skillPaths(): Array<[string, string]> {
  return [
    ["codex", join(homedir(), ".codex", "skills", "stariver")],
    ["claude", join(homedir(), ".claude", "skills", "stariver")],
  ];
}

function skillVersion(path: string): string | null {
  try { return normalizedVersion(readFileSync(join(path, "VERSION"), "utf8")); } catch { return null; }
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const releaseApi = process.env.STARIVER_RELEASE_API_URL || `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
  const response = await fetch(releaseApi, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `stariver-cli/${VERSION}` },
  });
  if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）`);
  const release = await response.json() as LatestRelease;
  const latestVersion = normalizedVersion(release.tag_name || "");
  if (!latestVersion) throw new Error("最新版本信息无效");

  const versions = Object.fromEntries(skillPaths().map(([name, path]) => [name, skillVersion(path)]));
  const relation = compareVersions(latestVersion, VERSION);
  const cliUpdate = relation > 0;
  const skillUpdate = relation >= 0 && Object.values(versions).some(
    (version) => version === null || compareVersions(latestVersion, version) > 0,
  );
  const installerName = process.platform === "win32" ? "install.ps1" : "install.sh";
  const installerUrl = release.assets?.find((asset) => asset.name === installerName)?.browser_download_url;

  return {
    current_version: VERSION,
    latest_version: latestVersion,
    cli_update_available: cliUpdate,
    skill_update_available: skillUpdate,
    update_available: cliUpdate || skillUpdate,
    skill_versions: versions,
    installer_url: installerUrl,
  };
}

function executableDirectory(): string {
  const name = basename(process.execPath).toLowerCase();
  if (name !== "stariver" && name !== "stariver.exe") {
    throw new Error("update 只能由已安装的 stariver 可执行文件运行");
  }
  return dirname(process.execPath);
}

async function runUnixInstaller(url: string, installDir: string, quiet: boolean): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载安装器失败（HTTP ${response.status}）`);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "stariver-update-"));
  const scriptPath = join(temporaryDirectory, "install.sh");
  try {
    writeFileSync(scriptPath, await response.text(), "utf8");
    chmodSync(scriptPath, 0o700);
    const child = Bun.spawn(["sh", scriptPath], {
      env: { ...process.env, STARIVER_SKIP_AUTH: "1", STARIVER_INSTALL_DIR: installDir },
      stdin: "ignore",
      stdout: quiet ? "pipe" : "inherit",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    if (exitCode !== 0) throw new Error(stderr.trim() || `更新安装器退出码：${exitCode}`);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function escapePowerShell(value: string): string {
  return value.replaceAll("'", "''");
}

function startWindowsInstaller(url: string, installDir: string): void {
  const command = [
    `$stariverProcessId=${process.pid}`,
    "Wait-Process -Id $stariverProcessId -ErrorAction SilentlyContinue",
    "$env:STARIVER_SKIP_AUTH='1'",
    `$env:STARIVER_INSTALL_DIR='${escapePowerShell(installDir)}'`,
    `Invoke-Expression (Invoke-RestMethod -Uri '${escapePowerShell(url)}')`,
  ].join("; ");
  const child = Bun.spawn(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  child.unref();
}

export async function installUpdate(status: UpdateStatus, quiet: boolean): Promise<{ deferred: boolean }> {
  if (!status.installer_url) throw new Error("最新发行版缺少更新安装器");
  const installDir = executableDirectory();
  if (process.platform === "win32") {
    startWindowsInstaller(status.installer_url, installDir);
    return { deferred: true };
  }
  await runUnixInstaller(status.installer_url, installDir, quiet);
  return { deferred: false };
}
