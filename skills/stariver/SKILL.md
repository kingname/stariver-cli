---
name: stariver
description: Use the installed stariver CLI to work with 渡星河 Chinese metaphysics services. Trigger when the user asks to create or read 紫微斗数 natal, 大限, 流年, 流月 or 飞星 reports; 八字 natal, 大运 or 流年 reports; 同盘互参, 星河解盘, 双星映辉合盘, 梅花易数, 星河落卦, 镜中人 or 星河日签; to list their Stariver archives and reports; or to update the CLI and this skill.
---

# 渡星河 CLI

Call `stariver` instead of reproducing API requests. Never read, print, or ask for the stored token.

## Workflow

1. Run `stariver archives list --json` when the user refers to a person by name but has not supplied a person ID.
2. Run `stariver reports list --json` when a report ID is required. Match the requested person, system, period, and completed status; ask only if multiple plausible reports remain.
3. Pass complete flags and `--json`. Do not rely on interactive prompts.
4. For long report jobs, prefer `--no-wait`, return the task ID, then use `stariver reports wait <id> --json` and `stariver reports show <id> --json`. Add `--type tongpan` for 同盘 tasks.
5. Report quota, validation, and authentication errors verbatim. Do not retry 4xx errors.

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

Pass `--ages <start,end>` for 紫微大限, `--year` for 流年, `--year --month` for 流月, and `--dayun <startYear,endYear>` for 八字大运. If the user has not chosen a valid 大限 or 大运 interval, run the command interactively or ask them to choose; never invent an interval.
