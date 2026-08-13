$ErrorActionPreference = "Stop"

$Repository = "kingname/stariver-cli"
$Token = $env:STARIVER_TOKEN
$SkipAuth = $env:STARIVER_SKIP_AUTH -eq "1"
$ReleaseTag = if ($env:STARIVER_RELEASE_TAG) {
  $env:STARIVER_RELEASE_TAG
} else {
  (Invoke-RestMethod "https://api.github.com/repos/$Repository/releases/latest").tag_name
}
if ([string]::IsNullOrWhiteSpace($Token) -and -not $SkipAuth) { throw "安装命令缺少 STARIVER_TOKEN，请从渡星河网页复制完整命令。" }
$Arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($Arch -ne "x64") { throw "Windows 首版仅支持 x64，当前架构：$Arch" }

$Artifact = "stariver-windows-x64.zip"
$Base = "https://github.com/$Repository/releases/download/$ReleaseTag"
$InstallDir = if ($env:STARIVER_INSTALL_DIR) { $env:STARIVER_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Stariver\bin" }
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("stariver-" + [guid]::NewGuid())

try {
  New-Item -ItemType Directory -Force -Path $TempDir, $InstallDir | Out-Null
  $Archive = Join-Path $TempDir $Artifact
  $Checksums = Join-Path $TempDir "checksums.txt"
  Invoke-WebRequest "$Base/$Artifact" -OutFile $Archive
  Invoke-WebRequest "$Base/checksums.txt" -OutFile $Checksums
  $ExpectedLine = Get-Content $Checksums | Where-Object { $_ -match "\s$([regex]::Escape($Artifact))$" } | Select-Object -First 1
  if (-not $ExpectedLine) { throw "校验文件中没有 $Artifact" }
  $Expected = ($ExpectedLine -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Expected -ne $Actual) { throw "下载文件校验失败" }

  Expand-Archive $Archive -DestinationPath $TempDir -Force
  Copy-Item (Join-Path $TempDir "stariver.exe") (Join-Path $InstallDir "stariver.exe") -Force
  $CodexSkill = Join-Path $HOME ".codex\skills\stariver"
  $ClaudeSkill = Join-Path $HOME ".claude\skills\stariver"
  Remove-Item $CodexSkill, $ClaudeSkill -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path (Split-Path $CodexSkill), (Split-Path $ClaudeSkill) | Out-Null
  Copy-Item (Join-Path $TempDir "skill\stariver") $CodexSkill -Recurse
  Copy-Item (Join-Path $TempDir "skill\stariver") $ClaudeSkill -Recurse

  if (-not $SkipAuth) {
    & (Join-Path $InstallDir "stariver.exe") auth set-token --json | Out-Null
  }
  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($null -eq $UserPath) { $UserPath = "" }
  if (($UserPath -split ";") -notcontains $InstallDir) {
    [Environment]::SetEnvironmentVariable("Path", (($UserPath.TrimEnd(";"), $InstallDir) -join ";"), "User")
    $env:Path = "$InstallDir;$env:Path"
  }
  Write-Host "渡星河 CLI 与 skill 已安装完成。重新打开终端后运行：stariver auth status"
}
finally {
  Remove-Item Env:STARIVER_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:STARIVER_SKIP_AUTH -ErrorAction SilentlyContinue
  Remove-Item Env:STARIVER_RELEASE_TAG -ErrorAction SilentlyContinue
  Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
