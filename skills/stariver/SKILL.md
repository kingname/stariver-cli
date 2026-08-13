---
name: stariver
description: Use the installed stariver CLI to work with 渡星河 Chinese metaphysics services. Trigger when the user asks to create or read 紫微斗数 natal, 大限, 流年, 流月 or 飞星 reports; 八字 natal, 大运 or 流年 reports; 同盘互参, 星河解盘, 双星映辉合盘, 梅花易数, 星河落卦, 镜中人 or 星河日签; to list their Stariver archives and reports; or to update the CLI and this skill.
---

# 渡星河 CLI

Call `stariver` instead of reproducing API requests. Never read or print an existing stored token. Only ask for a new token when authentication setup is required.

## 高成本报告确认

生成任何新的紫微、八字或同盘报告前，必须向用户说明将要生成的具体报告，并取得用户对本次生成的明确确认。即使用户最初已经要求生成，也要在执行生成命令前二次确认。未收到肯定答复时停止，不得运行 `stariver ziwei ...`、`stariver bazi ...` 或 `stariver tongpan ...`。

先查找是否已有符合人物、体系和时间范围的已完成报告。读取或解读已有报告无需确认；只有创建新报告需要确认。一次确认只适用于当次说明的报告，不要把其他操作的同意视为生成许可。

例如，用户问“2026 年运势如何”时，先查找对应的 2026 流年报告。如果不存在，说明“当前没有对应的 2026 流年报告，生成报告成本较高。是否允许我现在生成？”然后等待用户回答；不可自行生成。

## Workflow

1. Before the first authenticated command, run `stariver auth status --json`.
2. If no token is configured or authentication has expired, tell the user: open https://my.stariver.me, register or sign in, click the avatar in the top-right corner, obtain a new token, then send it to the agent for configuration. Wait for the user to provide it.
3. When the user provides the new token, configure it with `stariver auth set-token --token <token> --json`, verify with `stariver auth status --json`, then continue the original request. Never echo, quote, save it outside the CLI config, or include it in the final response.
4. Run `stariver archives list --json` when the user refers to a person by name but has not supplied a person ID.
5. Run `stariver reports list --json` when a report ID is required. Match the requested person, system, period, and completed status; ask only if multiple plausible reports remain.
6. Before creating 紫微大限 or 八字大运, run the same birth-based command with `--list --json`. These read-only calls dynamically derive the valid periods from the birthday, birth time, and sex. If the user named a target age or year, select the returned period containing it; otherwise ask the user to choose from the returned periods. Never invent or alter period boundaries.
7. Pass complete flags and `--json`. Do not rely on interactive prompts.
8. For long report jobs, prefer `--no-wait`, return the task ID, then use `stariver reports wait <id> --json` and `stariver reports show <id> --json`. Add `--type tongpan` for 同盘 tasks.
9. Report quota, validation, and authentication errors verbatim. Do not retry 4xx errors.

## Command map

- 紫微：`stariver ziwei natal|daxian|liunian|liuyue|feixing`
- 八字：`stariver bazi natal|dayun|liunian`
- 同盘互参：`stariver tongpan --report <紫微ID> --report-2 <八字ID>`
- 解盘：`stariver explain --report <ID> --question <问题>`
- 合盘：`stariver combine --report <ID1> --report-2 <ID2> --combine-type love|business|relationship`
- 梅花：`stariver meihua --question <问题> [--method time|number]`
- 落卦：`stariver luogua --question <现实处境>`
- 镜中人：`stariver mirror --report <ID> --question <问题> --mirror-type past|future`
- 星河日签：`stariver daily-sign --report <紫微本命ID>`
- 更新：`stariver update --json`

Use `--person <档案ID>` for birth-based reports. For direct birth data, pass `--birthday YYYY-MM-DD --sex 男|女` plus either `--shichen 0-12` or `--time HH:MM --city <城市>`.

For 紫微大限, first run `stariver ziwei daxian <birth flags> --list --json`, then pass one returned `ageRange` as `--ages <start,end>`. For 八字大运, first run `stariver bazi dayun <birth flags> --list --json`, then pass one returned period as `--dayun <startYear,endYear>`. The CLI rejects intervals that were not generated from the same birth information. Pass `--year` for 流年 and `--year --month` for 流月.
