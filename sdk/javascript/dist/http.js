"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestJson = requestJson;
const errors_1 = require("./errors");
async function requestJson(options, method, path, body) {
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    const headers = {};
    if (!isFormData) {
        headers["Content-Type"] = "application/json";
    }
    if (options.auth.type === "project") {
        headers["X-Project-Key"] = options.auth.projectKey;
        headers.Authorization = `Bearer ${options.auth.projectSecret}`;
    }
    else if (options.auth.type === "apiKey") {
        headers.Authorization = `Bearer ${options.auth.apiKey}`;
    }
    else if (options.auth.getAccessToken) {
        const token = await options.auth.getAccessToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    }
    const controller = new AbortController();
    const timeout = options.timeoutMs ?? 60000;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: body !== undefined
                ? (isFormData ? body : JSON.stringify(body))
                : undefined,
            signal: controller.signal,
        });
        if (!res.ok) {
            const text = await res.text();
            let detail = text;
            try {
                detail = JSON.parse(text);
            }
            catch {
                // keep raw text
            }
            const ErrorType = res.status === 401 || res.status === 403
                ? errors_1.DtorchAuthError
                : errors_1.DtorchApiError;
            const authMessage = options.auth.type === "project"
                ? "DT Orch authentication failed; verify or regenerate your project credentials in Studio"
                : "DT Orch authentication or authorization failed; verify the token and required scopes or roles";
            const message = res.status === 401 || res.status === 403
                ? authMessage
                : `DT Orch API ${method} ${path} failed (${res.status})`;
            throw new ErrorType(message, res.status, detail);
        }
        if (res.status === 204) {
            return undefined;
        }
        return (await res.json());
    }
    finally {
        clearTimeout(timer);
    }
}
