# 渡星河 CLI

`stariver` 把渡星河网页里的排盘、报告与流式问答能力带到终端，并随安装包提供 Codex / Claude Code skill。

```bash
bun install
bun run src/index.ts help
bun test
bun run build
```

发布由 `v*` tag 触发，GitHub Actions 会生成 macOS、Linux 和 Windows x64 的独立可执行文件、skill 与 SHA-256 校验文件。

本地调试可通过 `STARIVER_TOKEN` 和 `STARIVER_API_URL` 覆盖配置。不要提交真实 token。

常用命令包括 `stariver daily-sign --report <紫微本命ID>` 生成星河日签，以及 `stariver update` 自动更新 CLI 与随包分发的 Codex / Claude Code skill。
