#!/bin/sh
set -eu

REPOSITORY="kingname/stariver-cli"
INSTALL_DIR="${STARIVER_INSTALL_DIR:-${HOME}/.local/bin}"
TOKEN="${STARIVER_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "错误：安装命令缺少 STARIVER_TOKEN，请从渡星河网页复制完整命令。" >&2
  exit 1
fi

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) echo "暂不支持的系统：$os" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64) machine="x64" ;;
  arm64|aarch64) machine="arm64" ;;
  *) echo "暂不支持的架构：$arch" >&2; exit 1 ;;
esac

target="${platform}-${machine}"
if [ "$platform" = "linux" ] && (ldd --version 2>&1 || true) | grep -qi musl; then
  target="linux-${machine}-musl"
fi
artifact="stariver-${target}.tar.gz"
base="https://github.com/${REPOSITORY}/releases/latest/download"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "正在下载渡星河 CLI（${target}）…"
curl -fsSL "${base}/${artifact}" -o "${tmp}/${artifact}"
curl -fsSL "${base}/checksums.txt" -o "${tmp}/checksums.txt"
expected="$(awk -v file="$artifact" '$2 == file { print $1 }' "${tmp}/checksums.txt")"
[ -n "$expected" ] || { echo "校验文件中没有 ${artifact}" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${tmp}/${artifact}" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "${tmp}/${artifact}" | awk '{print $1}')"
fi
[ "$expected" = "$actual" ] || { echo "下载文件校验失败" >&2; exit 1; }

tar -xzf "${tmp}/${artifact}" -C "$tmp"
mkdir -p "$INSTALL_DIR"
install -m 755 "${tmp}/stariver" "${INSTALL_DIR}/stariver"
mkdir -p "${HOME}/.codex/skills" "${HOME}/.claude/skills"
rm -rf "${HOME}/.codex/skills/stariver" "${HOME}/.claude/skills/stariver"
cp -R "${tmp}/skill/stariver" "${HOME}/.codex/skills/stariver"
cp -R "${tmp}/skill/stariver" "${HOME}/.claude/skills/stariver"
STARIVER_TOKEN="$TOKEN" "${INSTALL_DIR}/stariver" auth set-token --json >/dev/null
unset TOKEN STARIVER_TOKEN

echo "渡星河 CLI 与 skill 已安装完成。"
echo "运行：stariver auth status"
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *) echo "请把 ${INSTALL_DIR} 加入 PATH，例如：export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
esac
