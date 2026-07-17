import { DtorchApiError, DtorchAuthError } from "./errors";

export type RequestAuth =
  | { type: "jwt"; getAccessToken?: () => Promise<string | null> | string | null }
  | { type: "project"; projectKey: string; projectSecret: string }
  | { type: "apiKey"; apiKey: string };

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
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  if (options.auth.type === "project") {
    headers["X-Project-Key"] = options.auth.projectKey;
    headers.Authorization = `Bearer ${options.auth.projectSecret}`;
  } else if (options.auth.type === "apiKey") {
    headers.Authorization = `Bearer ${options.auth.apiKey}`;
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
      body: body !== undefined
        ? (isFormData ? body as FormData : JSON.stringify(body))
        : undefined,
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
      const ErrorType = res.status === 401 || res.status === 403
        ? DtorchAuthError
        : DtorchApiError;
      const authMessage = options.auth.type === "project"
        ? "DT Orch authentication failed; verify or regenerate your project credentials in Studio"
        : "DT Orch authentication or authorization failed; verify the token and required scopes or roles";
      const message = res.status === 401 || res.status === 403
        ? authMessage
        : `DT Orch API ${method} ${path} failed (${res.status})`;
      throw new ErrorType(message, res.status, detail);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
