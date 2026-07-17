import { requestJson, type HttpClientOptions } from "./http";

type RuntimeClientBaseOptions = {
  baseUrl: string;
  workspaceId: number;
  timeoutMs?: number;
};

export type EltRuntimeClientOptions = RuntimeClientBaseOptions & (
  | { projectKey: string; projectSecret: string; apiKey?: never }
  | { apiKey: string; projectKey?: never; projectSecret?: never }
);

export class EltRuntimeClient {
  private http: HttpClientOptions;
  private workspaceId: number;

  constructor(options: EltRuntimeClientOptions) {
    this.workspaceId = options.workspaceId;
    this.http = {
      baseUrl: options.baseUrl,
      auth: "projectKey" in options && options.projectKey !== undefined
        ? {
            type: "project",
            projectKey: options.projectKey,
            projectSecret: options.projectSecret,
          }
        : { type: "apiKey", apiKey: options.apiKey },
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

  /** Push a message (requires `queue:push` scope). */
  queuePush(queueName: string, payload?: Record<string, unknown>) {
    return requestJson<{ id: number; payload: unknown; created_at?: string }>(
      this.http,
      "POST",
      `/api/v1/runtime/workspaces/${this.workspaceId}/queues/${encodeURIComponent(queueName)}/push`,
      { payload: payload ?? {} },
    );
  }

  /** Pop oldest message — destructive; returns null when empty (requires `queue:pop` scope). */
  async queuePop(queueName: string) {
    const url = `/api/v1/runtime/workspaces/${this.workspaceId}/queues/${encodeURIComponent(queueName)}/pop`;
    const result = await requestJson<{ id: number; payload: unknown; created_at?: string } | undefined>(
      this.http,
      "POST",
      url,
    );
    return result ?? null;
  }

  /** Peek at the oldest message without removing it (requires `queue:read` scope). */
  async queuePeek(queueName: string) {
    const url = `/api/v1/runtime/workspaces/${this.workspaceId}/queues/${encodeURIComponent(queueName)}/peek`;
    const result = await requestJson<{ id: number; payload: unknown; created_at?: string } | undefined>(
      this.http,
      "GET",
      url,
    );
    return result ?? null;
  }

  /** Publish realtime notification (requires `notification:publish` scope). */
  notificationPublish(
    channel: string,
    payload?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ) {
    return requestJson<{ channel: string; recipient_count: number; published: boolean }>(
      this.http,
      "POST",
      `/api/v1/runtime/workspaces/${this.workspaceId}/notifications/publish`,
      { channel, payload: payload ?? {}, ...(target ? { target } : {}) },
    );
  }
}
