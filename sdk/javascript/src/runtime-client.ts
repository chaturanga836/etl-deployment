import { requestJson, type HttpClientOptions } from "./http";

export type EltRuntimeClientOptions = {
  baseUrl: string;
  apiKey: string;
  workspaceId: number;
  timeoutMs?: number;
};

export class EltRuntimeClient {
  private http: HttpClientOptions;
  private workspaceId: number;

  constructor(options: EltRuntimeClientOptions) {
    this.workspaceId = options.workspaceId;
    this.http = {
      baseUrl: options.baseUrl,
      auth: {
        type: "jwt",
        getAccessToken: () => options.apiKey,
      },
      timeoutMs: options.timeoutMs ?? 60_000,
    };
  }

  runPipeline(pipelineUuid: string, input?: Record<string, unknown>) {
    return requestJson<{ run_id: number; status: string }>(
      this.http,
      "POST",
      `/api/v1/runtime/workspaces/${this.workspaceId}/pipelines/${pipelineUuid}/run`,
      { input: input ?? null },
    );
  }

  runWorkflow(workflowUuid: string, input?: Record<string, unknown>) {
    return requestJson<{ run_id: number; status: string }>(
      this.http,
      "POST",
      `/api/v1/runtime/workspaces/${this.workspaceId}/workflows/${workflowUuid}/run`,
      { input: input ?? null },
    );
  }

  invokeRest(
    connectionId: number,
    body?: {
      path?: string;
      method?: string;
      variables?: Record<string, unknown>;
      body?: Record<string, unknown>;
    },
  ) {
    return requestJson<{
      status_code: number;
      data: unknown;
      headers?: Record<string, unknown>;
    }>(
      this.http,
      "POST",
      `/api/v1/runtime/workspaces/${this.workspaceId}/rest/${connectionId}/invoke`,
      body ?? {},
    );
  }
}
