"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EltRuntimeClient = void 0;
const http_1 = require("./http");
class EltRuntimeClient {
    constructor(options) {
        this.workspaceId = options.workspaceId;
        this.http = {
            baseUrl: options.baseUrl,
            auth: {
                type: "jwt",
                getAccessToken: () => options.apiKey,
            },
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
}
exports.EltRuntimeClient = EltRuntimeClient;
