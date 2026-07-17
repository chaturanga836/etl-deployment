"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EltRuntimeClient = void 0;
const http_1 = require("./http");
class EltRuntimeClient {
    constructor(options) {
        this.workspaceId = options.workspaceId;
        this.http = {
            baseUrl: options.baseUrl,
            auth: { type: "apiKey", apiKey: options.apiKey },
            timeoutMs: options.timeoutMs ?? 60000,
        };
    }
    runPipeline(pipelineUuid, input) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/runtime/workspaces/${this.workspaceId}/pipelines/${pipelineUuid}/run`, { input: input ?? null });
    }
    runWorkflow(workflowUuid, input) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/runtime/workspaces/${this.workspaceId}/workflows/${workflowUuid}/run`, { input: input ?? null });
    }
    invokeRest(connectionId, body) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/runtime/workspaces/${this.workspaceId}/rest/${connectionId}/invoke`, body ?? {});
    }
    /** Push a message (requires `queue:push` scope). */
    queuePush(queueName, payload) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/runtime/workspaces/${this.workspaceId}/queues/${encodeURIComponent(queueName)}/push`, { payload: payload ?? {} });
    }
    /** Pop oldest message — destructive; returns null when empty (requires `queue:pop` scope). */
    async queuePop(queueName) {
        const url = `/api/v1/runtime/workspaces/${this.workspaceId}/queues/${encodeURIComponent(queueName)}/pop`;
        const result = await (0, http_1.requestJson)(this.http, "POST", url);
        return result ?? null;
    }
    /** Publish realtime notification (requires `notification:publish` scope). */
    notificationPublish(channel, payload, target) {
        return (0, http_1.requestJson)(this.http, "POST", `/api/v1/runtime/workspaces/${this.workspaceId}/notifications/publish`, { channel, payload: payload ?? {}, ...(target ? { target } : {}) });
    }
}
exports.EltRuntimeClient = EltRuntimeClient;
