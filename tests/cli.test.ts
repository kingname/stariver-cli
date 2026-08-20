import { afterAll, describe, expect, test } from "bun:test";

let createBody: Record<string, unknown> = {};
let dailySignBody: Record<string, unknown> = {};
let combineStreamAttempts = 0;
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/archive/person/list") {
      return Response.json({ success: true, data: { persons: [{ person_id: "p1", name: "甲", birthday: "1990-01-01", shichen: 3, sex: "男" }] } });
    }
    if (url.pathname === "/api/report/query") return Response.json({ success: true, data: [] });
    if (url.pathname === "/api/chat/history") {
      const sessionId = url.searchParams.get("session_id") || "explain-session";
      return Response.json({
        success: true,
        data: [{ _id: "h1", session_id: sessionId, report_id: "z1", question: "今年如何？", answer: "稳步推进。", created_at: "2026-08-20T08:00:00Z" }],
        total: 1,
      });
    }
    if (url.pathname === "/api/combine/sessions") {
      return Response.json({
        success: true,
        data: [{ _id: "c1", session_id: "combine-session", name_1: "甲", name_2: "乙", combine_type: "love", created_at: "2026-08-20T08:00:00Z" }],
        total: 1,
      });
    }
    if (url.pathname === "/api/combine/history") {
      return Response.json({
        success: true,
        data: [{ _id: "c1", session_id: url.searchParams.get("session_id"), question: "甲与乙的姻缘合盘", answer: "相处重在沟通。", created_at: "2026-08-20T08:00:00Z" }],
      });
    }
    if (url.pathname === "/api/combine/sse") {
      combineStreamAttempts += 1;
      if (combineStreamAttempts <= 6) {
        return new Response(`id: ${combineStreamAttempts}\ndata: {"chunk":"${combineStreamAttempts}"}\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response("id: 7\ndata: {\"chunk\":\"完成\"}\n\nid: 8\ndata: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (url.pathname === "/api/daxian_age_list") {
      return Response.json({
        success: true,
        data: [{ palaceName: "命宫", ageRange: [4, 13], startYear: 1993, endYear: 2002 }],
      });
    }
    if (url.pathname === "/api/dayun_year_list") {
      return Response.json({
        success: true,
        dayun_info_list: [{ year_start: 1998, year_end: 2007, ganzhi: "甲子" }],
      });
    }
    if (url.pathname === "/api/tongpan/tasks") {
      return Response.json({ success: true, data: [{ task_id: "tp1", report_type: "tongpan", status: "running" }] });
    }
    if (url.pathname === "/api/ziwei/create") {
      createBody = await request.json() as Record<string, unknown>;
      return Response.json({ success: true, task_id: createBody.task_id });
    }
    if (url.pathname === "/api/gui-gua/sse") {
      return new Response("id: 1\ndata: {\"chunk\":\"{\\\"answer\\\":\\\"ok\\\"}\"}\n\nevent: result\nid: 2\ndata: {\"result\":{\"answer\":\"ok\"}}\n\nid: 2\ndata: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (url.pathname === "/api/daily/sign" && request.method === "POST") {
      dailySignBody = await request.json() as Record<string, unknown>;
      return Response.json({
        success: true,
        result: { main_star: "紫微", keyword: "稳", score: 88, dos: ["规划"], donts: ["急进"], advice: "稳步前行" },
        today_lunar: { year: "丙午", month: "七月", day: "初一", shichen: "午时" },
      });
    }
    if (url.pathname === "/releases/latest") {
      return Response.json({ tag_name: "v0.2.7", assets: [] });
    }
    return new Response("not found", { status: 404 });
  },
});

afterAll(() => server.stop(true));

async function cli(...args: string[]) {
  const child = Bun.spawn([process.execPath, "src/index.ts", ...args], {
    cwd: import.meta.dir.replace(/\/tests$/, ""),
    env: {
      ...Bun.env,
      STARIVER_TOKEN: "test-token",
      STARIVER_API_URL: `http://127.0.0.1:${server.port}`,
      STARIVER_RELEASE_API_URL: `http://127.0.0.1:${server.port}/releases/latest`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

describe("CLI 请求映射", () => {
  test("列出档案返回稳定 JSON", async () => {
    const result = await cli("archives", "list", "--json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).persons[0].person_id).toBe("p1");
  });

  test("紫微流月参数映射到现有创建接口", async () => {
    const result = await cli("ziwei", "liuyue", "--birthday", "1990-01-01", "--sex", "男", "--shichen", "3", "--year", "2026", "--month", "8", "--no-wait", "--json");
    expect(result.exitCode).toBe(0);
    expect(createBody.report_type).toBe("ziwei");
    expect(createBody.sub_report_type).toBe("liuyue");
    expect(createBody.target_liunian).toBe(2026);
    expect(createBody.target_liuyue).toBe(8);
  });

  test("紫微大限只接受根据出生信息生成的区间", async () => {
    const listed = await cli("ziwei", "daxian", "--birthday", "1990-01-01", "--sex", "男", "--shichen", "3", "--list", "--json");
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout).daxian_age_list[0].ageRange).toEqual([4, 13]);

    const rejected = await cli("ziwei", "daxian", "--birthday", "1990-01-01", "--sex", "男", "--shichen", "3", "--ages", "1,10", "--no-wait", "--json");
    expect(rejected.exitCode).toBe(2);
    expect(JSON.parse(rejected.stdout).error).toContain("4,13");
  });

  test("八字大运只使用动态候选中的区间", async () => {
    const result = await cli("bazi", "dayun", "--birthday", "1990-01-01", "--sex", "男", "--shichen", "3", "--dayun", "1998,2007", "--no-wait", "--json");
    expect(result.exitCode).toBe(0);
    expect(createBody.target_dayun_info).toEqual({ year_start: 1998, year_end: 2007, ganzhi: "" });
  });

  test("参数错误在 JSON 模式下返回稳定错误", async () => {
    const result = await cli("explain", "--report", "--json");
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error).toContain("--report 缺少值");
    expect(result.stderr).not.toContain("Bun v");
  });

  test("查询同盘任务状态", async () => {
    const result = await cli("reports", "status", "tp1", "--type", "tongpan", "--json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ task_id: "tp1", status: "running" });
  });

  test("落卦非 JSON 模式只输出一次最终结果", async () => {
    const result = await cli("luogua", "--question", "test");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ answer: "ok" });
  });

  test("生成星河日签", async () => {
    const result = await cli("daily-sign", "--report", "z1", "--json");
    expect(result.exitCode).toBe(0);
    expect(dailySignBody.report_id).toBe("z1");
    expect(typeof dailySignBody.task_id).toBe("string");
    expect(JSON.parse(result.stdout).result.keyword).toBe("稳");
  });

  test("读取解盘与合盘历史", async () => {
    const explain = await cli("history", "explain", "show", "--session", "explain-session", "--json");
    expect(explain.exitCode).toBe(0);
    expect(JSON.parse(explain.stdout).data[0]).toMatchObject({ session_id: "explain-session", answer: "稳步推进。" });

    const combine = await cli("history", "combine", "show", "--session", "combine-session", "--json");
    expect(combine.exitCode).toBe(0);
    expect(JSON.parse(combine.stdout).data[0]).toMatchObject({ session_id: "combine-session", answer: "相处重在沟通。" });
  });

  test("合盘流式连接连续中断后继续续传", async () => {
    combineStreamAttempts = 0;
    const result = await cli(
      "combine", "--report", "z1", "--report-2", "z2", "--session", "retry-session", "--json",
    );
    expect(result.exitCode).toBe(0);
    expect(combineStreamAttempts).toBe(7);
    expect(JSON.parse(result.stdout).content).toBe("123456完成");
  }, 10_000);

  test("检查 CLI 与 skill 更新", async () => {
    const result = await cli("update", "--check", "--json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ current_version: "0.2.7", latest_version: "0.2.7", release_tag: "v0.2.7" });
  });
});
