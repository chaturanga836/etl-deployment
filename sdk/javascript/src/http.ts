import { EltClientError } from "./errors";

export type RequestAuth =
  | { type: "jwt"; getAccessToken?: () => Promise<string | null> | string | null }
  | { type: "project"; projectKey: string; projectSecret: string };

export type HttpClientOptions = {
  baseUrl: string;
  auth: RequestAuth;
  timeoutMs?: number;
};

export async function requestJson<T>(
  options: HttpClientOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.auth.type === "project") {
    headers["X-Project-Key"] = options.auth.projectKey;
    headers.Authorization = `Bearer ${options.auth.projectSecret}`;
  } else if (options.auth.getAccessToken) {
    const token = await options.auth.getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      let detail: unknown = text;
      try {
        detail = JSON.parse(text);
      } catch {
        // keep raw text
      }
      throw new EltClientError(
        `ELT API ${method} ${path} failed (${res.status})`,
        res.status,
        detail,
      );
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
