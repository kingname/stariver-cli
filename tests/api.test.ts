import { afterAll, describe, expect, test } from "bun:test";
import { StariverApi } from "../src/api";

const server = Bun.serve({
  port: 0,
  routes: {
    "/json": (request) => Response.json({ authorization: request.headers.get("authorization") }),
    "/stream": () => new Response("id: 1\ndata: {\"chunk\":\"星河\"}\n\nevent: result\nid: 2\ndata: {\"result\":{\"ok\":true}}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }),
  },
});

afterAll(() => server.stop(true));

describe("API 客户端", () => {
  const api = new StariverApi(`http://127.0.0.1:${server.port}`, "test-token");

  test("发送 Bearer token", async () => {
    const body = await api.json<{ authorization: string }>("/json");
    expect(body.authorization).toBe("Bearer test-token");
  });

  test("解析 SSE 事件类型和 ID", async () => {
    const events: Array<{ type: string; id: string; data: string }> = [];
    await api.sse("/stream", {}, (event) => events.push(event));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "message", id: "1", data: "{\"chunk\":\"星河\"}" });
    expect(events[1]?.type).toBe("result");
    expect(events[1]?.id).toBe("2");
  });
});
