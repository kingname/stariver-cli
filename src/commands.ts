import { setTimeout as delay } from "node:timers/promises";
import { booleanFlag, numberFlag, stringFlag } from "./args";
import { ApiError, StariverApi } from "./api";
import { clearConfig, configPath, loadConfig, saveConfig } from "./config";
import { ask, choose, eventChunk, isInteractive, output } from "./ui";
import type { ArchivePerson, BirthInput, JsonObject, ParsedArgs, ReportRow } from "./types";
import { checkForUpdate, installUpdate } from "./update";
import { VERSION } from "./version";

type CommandContext = {
  args: ParsedArgs;
  api: StariverApi;
  json: boolean;
};

const ACTIVE_STATUSES = new Set(["queued", "pending", "running", "processing", "created"]);

function query(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return `${path}?${search}`;
}

function required(value: string, label: string, json: boolean): Promise<string> {
  if (value) return Promise.resolve(value);
  if (!isInteractive(json)) throw new Error(`缺少 ${label}`);
  return ask(label);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

async function listArchives(api: StariverApi): Promise<ArchivePerson[]> {
  const body = await api.json<JsonObject>("/api/archive/person/list");
  return asArray<ArchivePerson>(asObject(body.data).persons);
}

async function listReports(api: StariverApi): Promise<ReportRow[]> {
  const standardBody = await api.json<unknown>("/api/report/query");
  const standard = Array.isArray(standardBody)
    ? standardBody as ReportRow[]
    : asArray<ReportRow>(asObject(standardBody).data);
  let tongpan: ReportRow[] = [];
  try {
    const body = await api.json<JsonObject>("/api/tongpan/tasks");
    tongpan = asArray<ReportRow>(body.data).map((item) => ({ ...item, report_type: "tongpan", sub_report_type: "tongpan" }));
  } catch {
    // 常规报告仍可使用，不让同盘列表故障阻断整个命令。
  }
  return [...standard, ...tongpan];
}

function reportLabel(report: ReportRow): string {
  const kind = report.report_type === "tongpan"
    ? "同盘互参"
    : `${report.report_type || "报告"}/${report.sub_report_type || "main"}`;
  return `${report.comment || report.birthday || "未命名"} · ${kind} · ${report.status || "unknown"} · ${report.task_id}`;
}

async function selectReport(
  ctx: CommandContext,
  flagName = "report",
  completedOnly = true,
  predicate: (report: ReportRow) => boolean = () => true,
): Promise<ReportRow> {
  const id = stringFlag(ctx.args, flagName);
  const rows = await listReports(ctx.api);
  if (id) {
    const found = rows.find((row) => row.task_id === id);
    if (found && !predicate(found)) throw new Error(`报告 ${id} 不适用于当前命令`);
    return found || { task_id: id };
  }
  const candidates = rows.filter((row) => (!completedOnly || row.status === "completed") && predicate(row));
  if (!isInteractive(ctx.json)) throw new Error(`缺少 --${flagName} <报告ID>`);
  return await choose("请选择报告", candidates, reportLabel);
}

async function resolveBirth(ctx: CommandContext): Promise<BirthInput> {
  const personId = stringFlag(ctx.args, "person");
  if (personId) {
    const person = (await listArchives(ctx.api)).find((item) => item.person_id === personId);
    if (!person) throw new Error(`找不到档案：${personId}`);
    return {
      birthday: person.birthday,
      shichen: person.shichen,
      sex: person.sex,
      name: person.name,
      archive_person_id: person.person_id,
    };
  }

  const birthday = await required(stringFlag(ctx.args, "birthday"), "阳历生日 YYYY-MM-DD", ctx.json);
  let sex = stringFlag(ctx.args, "sex");
  if (!sex && isInteractive(ctx.json)) sex = await ask("性别（男/女）");
  if (sex !== "男" && sex !== "女") throw new Error("--sex 仅支持 男 或 女");
  const birth: BirthInput = { birthday, sex, name: stringFlag(ctx.args, "name") };
  const time = stringFlag(ctx.args, "time");
  const city = stringFlag(ctx.args, "city");
  const lng = numberFlag(ctx.args, "lng");
  const lat = numberFlag(ctx.args, "lat");
  const shichen = numberFlag(ctx.args, "shichen");
  if (city || lng !== undefined || lat !== undefined) {
    birth.time = await required(time, "出生钟表时间 HH:MM", ctx.json);
    if (city) birth.city = city;
    else {
      if (lng === undefined || lat === undefined) throw new Error("经纬度时间需要同时提供 --lng 和 --lat");
      birth.lng = lng;
      birth.lat = lat;
    }
  } else {
    let resolved = shichen;
    if (resolved === undefined && isInteractive(ctx.json)) resolved = Number(await ask("时辰编号 0-12"));
    if (resolved === undefined || !Number.isInteger(resolved) || resolved < 0 || resolved > 12) {
      throw new Error("请提供 --shichen 0-12，或 --time 配合 --city / --lng --lat");
    }
    birth.shichen = resolved;
  }
  return birth;
}

function reportSummary(row: ReportRow): JsonObject {
  return {
    report_id: row.task_id,
    report_type: row.report_type,
    sub_report_type: row.sub_report_type,
    status: row.status,
    name: row.comment || "",
    birthday: row.birthday,
    shichen: row.shichen,
    sex: row.sex,
    created_at: row.created_at,
  };
}

async function reportStatus(api: StariverApi, id: string): Promise<JsonObject> {
  return await api.json<JsonObject>(query("/api/ziwei/check", { task_id: id }));
}

async function waitStandardReport(api: StariverApi, id: string): Promise<JsonObject> {
  while (true) {
    const status = await reportStatus(api, id);
    const value = String(status.status || "unknown");
    if (value === "completed") return status;
    if (value === "failed") throw new Error(String(status.error || "报告生成失败"));
    if (!ACTIVE_STATUSES.has(value)) throw new Error(`未知报告状态：${value}`);
    console.error(`报告 ${id} 状态：${value}，继续等待…`);
    await delay(value === "queued" ? 15_000 : 3_000);
  }
}

async function waitTongpan(api: StariverApi, id: string): Promise<ReportRow> {
  while (true) {
    const task = await tongpanStatus(api, id);
    if (task.status === "completed") return task;
    if (task.status === "failed") throw new Error(String(task.error || "同盘报告生成失败"));
    console.error(`同盘 ${id} 状态：${task.status || "unknown"}，继续等待…`);
    await delay(5_000);
  }
}

async function tongpanStatus(api: StariverApi, id: string): Promise<ReportRow> {
  const body = await api.json<JsonObject>("/api/tongpan/tasks");
  const task = asArray<ReportRow>(body.data).find((item) => item.task_id === id);
  if (!task) throw new Error("同盘任务不存在");
  return task;
}

async function reportMarkdown(api: StariverApi, id: string, type = ""): Promise<string> {
  if (type === "tongpan") return await api.text(query("/api/tongpan/report", { task_id: id, format: "markdown" }));
  return await api.text(query("/api/ziwei/download", { task_id: id, pdf: false, report_format: "markdown" }));
}

async function createReport(ctx: CommandContext, reportType: "ziwei" | "bazi", subType: string): Promise<void> {
  const birth = await resolveBirth(ctx);
  const body: JsonObject = {
    ...birth,
    task_id: crypto.randomUUID(),
    report_type: reportType,
    sub_report_type: subType,
    lang: "zh-CN",
  };
  if (reportType === "ziwei" && subType === "daxian") {
    const agesFlag = stringFlag(ctx.args, "ages");
    if (agesFlag) {
      const ages = agesFlag.split(",").map(Number);
      if (ages.length !== 2 || ages.some((value) => !Number.isInteger(value))) throw new Error("--ages 格式应为 起始虚岁,结束虚岁");
      body.target_daxian_age = ages;
    } else {
      if (!isInteractive(ctx.json)) throw new Error("大限报告需要 --ages 起始虚岁,结束虚岁");
      const result = await ctx.api.post<JsonObject>("/api/daxian_age_list", { ...birth, report_type: "ziwei", lang: "zh-CN" });
      const selected = await choose<JsonObject>("请选择大限", asArray<JsonObject>(result.data), (item) => {
        const range = asArray<number>(item.ageRange);
        return `${range.join("-")}岁 · ${String(item.palaceName || "")}`;
      });
      body.target_daxian_age = selected.ageRange;
    }
  }
  if (subType === "liunian") {
    const year = numberFlag(ctx.args, "year") ?? (isInteractive(ctx.json) ? Number(await ask("目标年份")) : undefined);
    if (!year) throw new Error("流年报告需要 --year");
    body.target_liunian = year;
  }
  if (reportType === "ziwei" && subType === "liuyue") {
    const year = numberFlag(ctx.args, "year") ?? (isInteractive(ctx.json) ? Number(await ask("农历年份")) : undefined);
    const month = numberFlag(ctx.args, "month") ?? (isInteractive(ctx.json) ? Number(await ask("农历月份 1-12")) : undefined);
    if (!year || !month || month < 1 || month > 12) throw new Error("流月报告需要 --year 和 --month 1-12");
    body.target_liunian = year;
    body.target_liuyue = month;
  }
  if (reportType === "ziwei" && subType === "feixing" && numberFlag(ctx.args, "year")) body.target_liunian = numberFlag(ctx.args, "year");
  if (reportType === "bazi" && subType === "dayun") {
    const dayunFlag = stringFlag(ctx.args, "dayun");
    if (dayunFlag) {
      const [yearStart, yearEnd] = dayunFlag.split(",").map(Number);
      if (!yearStart || !yearEnd) throw new Error("--dayun 格式应为 起始年,结束年");
      body.target_dayun_info = { year_start: yearStart, year_end: yearEnd, ganzhi: "" };
    } else {
      if (!isInteractive(ctx.json)) throw new Error("大运报告需要 --dayun 起始年,结束年");
      const result = await ctx.api.post<JsonObject>("/api/dayun_year_list", { ...birth, report_type: "bazi", lang: "zh-CN" });
      const selected = await choose<JsonObject>("请选择大运", asArray<JsonObject>(result.dayun_info_list), (item) => `${item.year_start}-${item.year_end} · ${item.ganzhi}`);
      body.target_dayun_info = selected;
    }
  }
  const created = await ctx.api.post<JsonObject>("/api/ziwei/create", body);
  const taskId = String(created.task_id || body.task_id);
  if (booleanFlag(ctx.args, "no-wait")) return output({ ...created, task_id: taskId, report_id: taskId }, ctx.json);
  console.error(`任务已创建：${taskId}。可随时按 Ctrl-C 离开，稍后运行 stariver reports wait ${taskId}。`);
  await waitStandardReport(ctx.api, taskId);
  const markdown = await reportMarkdown(ctx.api, taskId);
  output(ctx.json ? { task_id: taskId, report_id: taskId, status: "completed", markdown } : markdown, ctx.json);
}

async function commandReports(ctx: CommandContext, action: string): Promise<void> {
  if (action === "list") {
    const rows = (await listReports(ctx.api)).map(reportSummary);
    if (ctx.json) return output({ reports: rows }, true);
    rows.forEach((row) => console.log(`${row.report_id}\t${row.status}\t${row.report_type}/${row.sub_report_type}\t${row.name || row.birthday || ""}`));
    return;
  }
  const id = stringFlag(ctx.args, "report") || ctx.args.positionals[2] || "";
  if (!id) throw new Error(`reports ${action} 需要报告 ID`);
  if (action === "status") {
    const status = stringFlag(ctx.args, "type") === "tongpan"
      ? await tongpanStatus(ctx.api, id)
      : await reportStatus(ctx.api, id);
    return output(status, ctx.json);
  }
  if (action === "wait") {
    const type = stringFlag(ctx.args, "type");
    const status = type === "tongpan" ? await waitTongpan(ctx.api, id) : await waitStandardReport(ctx.api, id);
    return output(status, ctx.json);
  }
  if (action === "show") {
    let type = stringFlag(ctx.args, "type");
    if (!type) type = (await listReports(ctx.api)).find((row) => row.task_id === id)?.report_type || "";
    const markdown = await reportMarkdown(ctx.api, id, type);
    return output(ctx.json ? { report_id: id, report_type: type || "standard", markdown } : markdown, ctx.json);
  }
  throw new Error("reports 支持 list、status、wait、show");
}

async function commandTongpan(ctx: CommandContext): Promise<void> {
  const available = await ctx.api.json<JsonObject>("/api/tongpan/reports");
  const ziwei = asArray<ReportRow>(available.ziwei_reports);
  const bazi = asArray<ReportRow>(available.bazi_reports);
  let ziweiId = stringFlag(ctx.args, "report");
  let baziId = stringFlag(ctx.args, "report-2");
  if (!ziweiId) ziweiId = (await choose("请选择紫微本命报告", ziwei, reportLabel)).task_id;
  const ziweiRow = ziwei.find((item) => item.task_id === ziweiId);
  const matchingBazi = ziweiRow ? bazi.filter((item) => item.birthday === ziweiRow.birthday && item.shichen === ziweiRow.shichen && item.sex === ziweiRow.sex) : bazi;
  if (!baziId) baziId = (await choose("请选择同一生辰的八字本命报告", matchingBazi, reportLabel)).task_id;
  const created = await ctx.api.post<JsonObject>("/api/tongpan/create", { ziwei_task_id: ziweiId, bazi_task_id: baziId });
  const id = String(created.task_id || "");
  if (!id || booleanFlag(ctx.args, "no-wait")) return output(created, ctx.json);
  console.error(`任务已创建：${id}。可随时按 Ctrl-C 离开，稍后运行 stariver reports wait ${id} --type tongpan。`);
  await waitTongpan(ctx.api, id);
  const markdown = await reportMarkdown(ctx.api, id, "tongpan");
  output(ctx.json ? { task_id: id, report_id: id, status: "completed", markdown } : markdown, ctx.json);
}

type StreamResult = { content: string; history_id?: string; result?: unknown };

async function streamRequest(ctx: CommandContext, path: string, body: JsonObject, streamOutput = true): Promise<StreamResult> {
  const eventId = String(body.event_id || crypto.randomUUID());
  let lastEventId = String(body.last_event_id || "");
  let content = "";
  let historyId = "";
  let result: unknown;
  for (let retry = 0; retry < 6; retry += 1) {
    try {
      await ctx.api.sse(path, { ...body, event_id: eventId, last_event_id: lastEventId }, (event) => {
        if (event.data === "[DONE]") return;
        if (event.id && event.type !== "history" && event.type !== "result") lastEventId = event.id;
        let parsed: JsonObject = {};
        try { parsed = asObject(JSON.parse(event.data)); } catch { /* plain stream chunk */ }
        if (event.type === "history") {
          historyId = String(parsed.history_id || "");
          return;
        }
        if (event.type === "result") {
          result = parsed.result ?? parsed;
          return;
        }
        if (event.type === "meta") return;
        if (event.type === "error") throw new ApiError(String(parsed.message || event.data), 400);
        const chunk = eventChunk(event.data);
        if (chunk) {
          content += chunk;
          if (!ctx.json && streamOutput) process.stdout.write(chunk);
        }
      });
      if (!ctx.json && streamOutput && content && !content.endsWith("\n")) process.stdout.write("\n");
      return { content, history_id: historyId || undefined, result };
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
      if (retry === 5) throw error;
      console.error("流式连接中断，正在续传…");
      await delay(1_000);
    }
  }
  throw new Error("流式请求失败");
}

async function commandExplain(ctx: CommandContext): Promise<void> {
  const report = await selectReport(ctx);
  let question = await required(stringFlag(ctx.args, "question"), "想问渡小星什么", ctx.json);
  const messages: JsonObject[] = [];
  const sessionId = stringFlag(ctx.args, "session") || crypto.randomUUID();
  let latest: StreamResult | undefined;
  while (question) {
    messages.push({ role: "user", content: question });
    latest = await streamRequest(ctx, "/api/explain/sse", {
      report_id: report.task_id,
      report_type: "report_id",
      messages,
      model: stringFlag(ctx.args, "model") || "standard",
      session_id: sessionId,
    });
    messages.push({ role: "model", content: latest.content });
    if (!isInteractive(ctx.json)) break;
    question = await ask("继续追问（直接回车退出）");
  }
  if (ctx.json) output({ report_id: report.task_id, session_id: sessionId, ...latest }, true);
}

async function commandMirror(ctx: CommandContext): Promise<void> {
  const report = await selectReport(ctx);
  let question = await required(stringFlag(ctx.args, "question"), "想和镜中人说什么", ctx.json);
  const messages: JsonObject[] = [];
  let latest: StreamResult | undefined;
  while (question) {
    messages.push({ role: "user", content: question });
    latest = await streamRequest(ctx, "/api/mirror/sse", {
      report_id: report.task_id,
      report_type: "report_id",
      mirror_type: stringFlag(ctx.args, "mirror-type") || "past",
      messages,
      fast: booleanFlag(ctx.args, "fast"),
    });
    messages.push({ role: "model", content: latest.content });
    if (!isInteractive(ctx.json)) break;
    question = await ask("继续对话（直接回车退出）");
  }
  if (ctx.json) output({ report_id: report.task_id, ...latest }, true);
}

async function commandMeihua(ctx: CommandContext): Promise<void> {
  const question = await required(stringFlag(ctx.args, "question"), "所占何事", ctx.json);
  const method = stringFlag(ctx.args, "method") || "time";
  const body: JsonObject = {
    question,
    mode: stringFlag(ctx.args, "mode") || "standard",
    lang: "zh-CN",
    divination_method: method,
  };
  if (method === "number") {
    body.number1 = numberFlag(ctx.args, "number1") ?? Number(await required("", "第一个数字 1-999", ctx.json));
    body.number2 = numberFlag(ctx.args, "number2") ?? Number(await required("", "第二个数字 1-999", ctx.json));
  }
  const result = await streamRequest(ctx, "/api/ask/sse/v2", body);
  if (ctx.json) return output(result, true);
  if (!result.history_id || !isInteractive(false)) return;
  let followup = await ask("继续追问（直接回车退出）");
  while (followup) {
    await streamRequest(ctx, "/api/meihua/followup/sse", { history_id: result.history_id, question: followup, lang: "zh-CN" });
    followup = await ask("继续追问（直接回车退出）");
  }
}

async function commandLuogua(ctx: CommandContext): Promise<void> {
  const question = await required(stringFlag(ctx.args, "question"), "写下眼下最卡住的现实处境", ctx.json);
  const result = await streamRequest(ctx, "/api/gui-gua/sse", { question, save_history: true }, false);
  if (ctx.json) return output(result, true);
  if (result.result !== undefined) output(result.result, false);
  if (!result.history_id || !isInteractive(false)) return;
  let followup = await ask("继续追问（直接回车退出）");
  while (followup) {
    await streamRequest(ctx, "/api/gui-gua/followup/sse", { history_id: result.history_id, question: followup });
    followup = await ask("继续追问（直接回车退出）");
  }
}

async function commandCombine(ctx: CommandContext): Promise<void> {
  const isCombineReport = (report: ReportRow) => report.report_type !== "tongpan";
  const first = await selectReport(ctx, "report", true, isCombineReport);
  const second = await selectReport(ctx, "report-2", true, isCombineReport);
  if (first.task_id === second.task_id) throw new Error("合盘需要选择两份不同的报告");
  const combineType = stringFlag(ctx.args, "combine-type") || "love";
  const sessionId = stringFlag(ctx.args, "session") || crypto.randomUUID();
  const baseBody: JsonObject = {
    report_id_1: first.task_id,
    report_id_1_type: "report_id",
    report_id_2: second.task_id,
    report_id_2_type: "report_id",
    combine_type: combineType,
    relationship: combineType === "relationship" ? stringFlag(ctx.args, "relationship") : "",
    session_id: sessionId,
    name_1: stringFlag(ctx.args, "name-1") || "甲方",
    name_2: stringFlag(ctx.args, "name-2") || "乙方",
    messages: [],
  };
  let result = await streamRequest(ctx, "/api/combine/sse", baseBody);
  if (ctx.json) return output({ report_id_1: first.task_id, report_id_2: second.task_id, session_id: sessionId, ...result }, true);
  if (!isInteractive(false)) return;
  const messages: JsonObject[] = [{ role: "model", content: result.content }];
  let followup = await ask("继续追问（直接回车退出）");
  while (followup) {
    messages.push({ role: "user", content: followup });
    result = await streamRequest(ctx, "/api/combine/sse", { ...baseBody, messages });
    messages.push({ role: "model", content: result.content });
    followup = await ask("继续追问（直接回车退出）");
  }
}

async function commandDailySign(ctx: CommandContext): Promise<void> {
  const report = await selectReport(
    ctx,
    "report",
    true,
    (row) => row.report_type === "ziwei" && row.sub_report_type === "main",
  );
  const taskId = crypto.randomUUID();
  const created = await ctx.api.post<JsonObject>("/api/daily/sign", { report_id: report.task_id, task_id: taskId });
  if (created.success === false) throw new Error(String(created.message || "星河日签生成失败"));
  if (created.result) return output({ ...created, task_id: taskId, report_id: report.task_id }, ctx.json);
  if (booleanFlag(ctx.args, "no-wait")) {
    return output({ ...created, task_id: taskId, report_id: report.task_id }, ctx.json);
  }

  console.error(`日签任务已创建：${taskId}，正在生成…`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await delay(3_000);
    const result = await ctx.api.json<JsonObject>(query("/api/daily/sign", { task_id: taskId }));
    if (result.success && result.result) {
      return output({ ...result, task_id: taskId, report_id: report.task_id }, ctx.json);
    }
  }
  throw new Error("星河日签生成超时，请稍后重试");
}

async function commandUpdate(ctx: CommandContext): Promise<void> {
  const status = await checkForUpdate();
  if (!status.update_available) {
    return output(ctx.json ? status : `当前已是最新版本：${status.current_version}`, ctx.json);
  }
  if (booleanFlag(ctx.args, "check")) {
    return output(ctx.json ? status : `发现新版本 ${status.latest_version}，运行 stariver update 即可更新。`, ctx.json);
  }
  console.error(`发现新版本：CLI ${status.current_version} → ${status.latest_version}，正在更新 CLI 与 skill…`);
  const installed = await installUpdate(status, ctx.json);
  const result = {
    ...status,
    success: true,
    updated: !installed.deferred,
    update_started: installed.deferred,
    message: installed.deferred ? "更新将在当前进程退出后完成，请稍后重新打开终端" : "CLI 与 skill 已更新完成",
  };
  output(ctx.json ? result : result.message, ctx.json);
}

async function commandAuth(ctx: CommandContext, action: string): Promise<void> {
  if (action === "logout") {
    clearConfig();
    return output({ success: true, message: "CLI 登录凭据已删除" }, ctx.json);
  }
  if (action === "set-token") {
    const token = await required(stringFlag(ctx.args, "token") || process.env.STARIVER_TOKEN || "", "渡星河 token", ctx.json);
    const testApi = new StariverApi(ctx.api.baseUrl, token);
    const user = await testApi.json<JsonObject>("/api/user");
    saveConfig({ ...loadConfig(), token, apiUrl: ctx.api.baseUrl });
    return output({ success: true, config_path: configPath(), user }, ctx.json);
  }
  if (action === "status") {
    const user = await ctx.api.json<JsonObject>("/api/user");
    return output({ authenticated: true, config_path: configPath(), user }, ctx.json);
  }
  throw new Error("auth 支持 status、set-token、logout");
}

export async function runCommand(ctx: CommandContext): Promise<void> {
  const [positionalCommand = "help", action = ""] = ctx.args.positionals;
  const command = booleanFlag(ctx.args, "version") ? "version" : positionalCommand;
  if (command === "help" || command === "--help") return output(HELP, false);
  if (command === "version") return output(`stariver ${VERSION}`, false);
  if (command === "update") return await commandUpdate(ctx);
  if (command === "auth") return await commandAuth(ctx, action);
  if (command === "archives" && action === "list") {
    const persons = await listArchives(ctx.api);
    if (ctx.json) return output({ persons }, true);
    persons.forEach((person) => console.log(`${person.person_id}\t${person.name}\t${person.birthday}\t${person.shichen}\t${person.sex}\t${person.report_count || 0}份报告`));
    return;
  }
  if (command === "reports") return await commandReports(ctx, action || "list");
  if (command === "ziwei") {
    const map: Record<string, string> = { natal: "main", daxian: "daxian", liunian: "liunian", liuyue: "liuyue", feixing: "feixing" };
    if (!map[action]) throw new Error("ziwei 支持 natal、daxian、liunian、liuyue、feixing");
    return await createReport(ctx, "ziwei", map[action]);
  }
  if (command === "bazi") {
    const map: Record<string, string> = { natal: "main", dayun: "dayun", liunian: "liunian" };
    if (!map[action]) throw new Error("bazi 支持 natal、dayun、liunian");
    return await createReport(ctx, "bazi", map[action]);
  }
  if (command === "tongpan") return await commandTongpan(ctx);
  if (command === "explain") return await commandExplain(ctx);
  if (command === "combine") return await commandCombine(ctx);
  if (command === "meihua") return await commandMeihua(ctx);
  if (command === "luogua") return await commandLuogua(ctx);
  if (command === "mirror") return await commandMirror(ctx);
  if (command === "daily-sign") return await commandDailySign(ctx);
  throw new Error(`未知命令：${command}\n\n${HELP}`);
}

export const HELP = `渡星河 CLI

用法：stariver <命令> [子命令] [参数]

  ziwei natal|daxian|liunian|liuyue|feixing  紫微报告
  bazi natal|dayun|liunian                   八字报告
  tongpan                                    同盘互参
  explain                                    星河解盘
  combine                                    双星映辉合盘
  meihua                                     梅花易数
  luogua                                     星河落卦
  mirror                                     镜中人
  daily-sign                                 星河日签
  update                                     更新 CLI 与 skill
  archives list                              列出档案
  reports list|status|wait|show              管理报告
  auth status|set-token|logout               管理登录凭据

通用参数：
  --person <档案ID>                          从档案读取出生信息
  --birthday YYYY-MM-DD --sex 男|女          直接输入出生信息
  --shichen 0-12                             使用真太阳时时辰
  --time HH:MM --city 城市                   使用城市钟表时间
  --json                                     JSON 输出且不进行交互询问
  --no-wait                                  创建长任务后立即返回

示例：
  stariver archives list
  stariver ziwei liuyue --person <id> --year 2026 --month 8
  stariver explain --report <id> --question "今年适合换工作吗？"
`;
