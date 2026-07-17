"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EltRealtimeClient = void 0;
const centrifuge_1 = require("centrifuge");
const http_1 = require("./http");
class EltRealtimeClient {
    constructor(options) {
        this.centrifuge = null;
        this.subscriptions = new Map();
        this.http = {
            baseUrl: options.baseUrl,
            auth: "projectKey" in options && options.projectKey !== undefined
                ? {
                    type: "project",
                    projectKey: options.projectKey,
                    projectSecret: options.projectSecret,
                }
                : { type: "jwt", getAccessToken: options.getAccessToken },
            timeoutMs: options.timeoutMs ?? 60000,
        };
        this.tokenPath = "projectKey" in options && options.projectKey !== undefined
            ? `/api/v1/workspaces/${options.workspaceId}/notifications/realtime-token`
            : "/api/v1/notifications/realtime-token";
    }
    async connect() {
        const tokenRes = await (0, http_1.requestJson)(this.http, "GET", this.tokenPath);
        this.centrifuge = new centrifuge_1.Centrifuge(tokenRes.ws_url, { token: tokenRes.token });
        this.centrifuge.connect();
    }
    subscribe(channel, handler) {
        if (!this.centrifuge) {
            throw new Error("Not connected — call connect() first");
        }
        const sub = this.centrifuge.newSubscription(channel);
        sub.on("publication", (ctx) => handler(ctx.data));
        sub.subscribe();
        this.subscriptions.set(channel, sub);
    }
    unsubscribe(channel) {
        const sub = this.subscriptions.get(channel);
        if (sub) {
            sub.unsubscribe();
            sub.removeAllListeners();
            this.subscriptions.delete(channel);
        }
    }
    on(event, handler) {
        if (!this.centrifuge) {
            throw new Error("Not connected — call connect() first");
        }
        this.centrifuge.on(event, handler);
    }
    disconnect() {
        for (const channel of [...this.subscriptions.keys()]) {
            this.unsubscribe(channel);
        }
        this.centrifuge?.disconnect();
        this.centrifuge = null;
    }
}
exports.EltRealtimeClient = EltRealtimeClient;
