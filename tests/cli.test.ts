import { afterAll, describe, expect, test } from "bun:test";

let createBody: Record<string, unknown> = {};
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/archive/person/list") {
      return Response.json({ success: true, data: { persons: [{ person_id: "p1", name: "甲", birthday: "1990-01-01", shichen: 3, sex: "男" }] } });
    }
    if (url.pathname === "/api/report/query") return Response.json({ success: true, data: [] });
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
    return new Response("not found", { status: 404 });
  },
});

afterAll(() => server.stop(true));

async function cli(...args: string[]) {
  const child = Bun.spawn([process.execPath, "src/index.ts", ...args], {
    cwd: import.meta.dir.replace(/\/tests$/, ""),
    env: { ...Bun.env, STARIVER_TOKEN: "test-token", STARIVER_API_URL: `http://127.0.0.1:${server.port}` },
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
});
