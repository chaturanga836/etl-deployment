"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestJson = requestJson;
const errors_1 = require("./errors");
async function requestJson(options, method, path, body) {
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    const headers = {
        "Content-Type": "application/json",
    };
    if (options.auth.type === "project") {
        headers["X-Project-Key"] = options.auth.projectKey;
        headers.Authorization = `Bearer ${options.auth.projectSecret}`;
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
            body: body !== undefined ? JSON.stringify(body) : undefined,
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
            throw new errors_1.EltClientError(`ELT API ${method} ${path} failed (${res.status})`, res.status, detail);
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
