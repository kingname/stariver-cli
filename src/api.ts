import type { JsonObject, SseEvent } from "./types";
import { VERSION } from "./version";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body;
  if (!body || typeof body !== "object") return fallback;
  const detail = (body as JsonObject).detail ?? (body as JsonObject).message ?? (body as JsonObject).error;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return String((item as JsonObject).msg || (item as JsonObject).message || JSON.stringify(item));
      return String(item);
    }).join("；");
  }
  return fallback;
}

export class StariverApi {
  constructor(readonly baseUrl: string, private readonly token: string) {}

  private headers(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("User-Agent", `stariver-cli/${VERSION}`);
    headers.set("Referer", "https://stariver.me/");
    return headers;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = this.headers(init.headers);
    let body = init.body;
    if (body && typeof body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, body });
    if (!response.ok) {
      let parsed: unknown;
      try { parsed = await response.clone().json(); } catch { parsed = await response.text(); }
      if (response.status === 401) throw new ApiError("登录凭据已失效，请重新从渡星河网页安装 CLI。", 401);
      throw new ApiError(errorMessage(parsed, `渡星河接口请求失败（HTTP ${response.status}）`), response.status);
    }
    return response;
  }

  async json<T = JsonObject>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    return await response.json() as T;
  }

  async post<T = JsonObject>(path: string, body: JsonObject): Promise<T> {
    return await this.json<T>(path, { method: "POST", body: JSON.stringify(body) });
  }

  async text(path: string): Promise<string> {
    return await (await this.request(path)).text();
  }

  async sse(path: string, body: JsonObject, onEvent: (event: SseEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!response.body) throw new Error("服务器没有返回流式响应");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let data: string[] = [];
    let type = "message";
    let id = "";
    let completed = false;
    const flush = () => {
      if (data.length) {
        const event = { type, id, data: data.join("\n") };
        if (event.data === "[DONE]") completed = true;
        onEvent(event);
      }
      data = [];
      type = "message";
    };
    const consume = (raw: string) => {
      const line = raw.replace(/\r$/, "");
      if (!line) return flush();
      if (line.startsWith(":")) return;
      if (line.startsWith("event:")) type = line.slice(6).trim() || "message";
      else if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    if (buffer) consume(buffer);
    flush();
    if (!completed) throw new Error("流式响应在完成前中断");
  }
}
