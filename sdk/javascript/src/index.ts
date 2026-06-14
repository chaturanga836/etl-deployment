export type EltClientOptions = {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null> | string | null;
};

export class EltClient {
  private baseUrl: string;
  private getAccessToken?: EltClientOptions["getAccessToken"];

  constructor(options: EltClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getAccessToken = options.getAccessToken;
  }

  private async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const token = this.getAccessToken ? await this.getAccessToken() : null;
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: await this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ELT API ${method} ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  signup(body: { email: string; password: string; org_name: string }) {
    return this.request<{ message: string }>("POST", "/api/v1/auth/signup", body);
  }

  getAccount() {
    return this.request<unknown>("GET", "/api/v1/studio/account");
  }

  listProjects(orgId?: number) {
    const q = orgId ? `?org_id=${orgId}` : "";
    return this.request<{ items: unknown[]; total: number }>("GET", `/api/v1/studio/projects${q}`);
  }

  createProject(body: { name: string; slug?: string; description?: string }, orgId?: number) {
    const q = orgId ? `?org_id=${orgId}` : "";
    return this.request<unknown>("POST", `/api/v1/studio/projects${q}`, body);
  }

  listServices(availableOnly = false) {
    const q = availableOnly ? "?available_only=true" : "";
    return this.request<unknown[]>("GET", `/api/v1/studio/services${q}`);
  }

  listWorkspaces() {
    return this.request<unknown>("GET", "/api/v1/workspaces/");
  }
}

export type EltRuntimeClientOptions = {
  baseUrl: string;
  apiKey: string;
  workspaceId: number;
};

export class EltRuntimeClient {
  private baseUrl: string;
  private apiKey: string;
  private workspaceId: number;

  constructor(options: EltRuntimeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.workspaceId = options.workspaceId;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ELT Runtime ${method} ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  runPipeline(pipelineUuid: string, input?: Record<string, unknown>) {
    return this.request<{ run_id: number; status: string }>(
      "POST",
      `/api/v1/runtime/workspaces/${this.workspaceId}/pipelines/${pipelineUuid}/run`,
      { input: input ?? null },
    );
  }

  runWorkflow(workflowUuid: string, input?: Record<string, unknown>) {
    return this.request<{ run_id: number; status: string }>(
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
    return this.request<{
      status_code: number;
      data: unknown;
      headers?: Record<string, unknown>;
    }>(
      "POST",
      `/api/v1/runtime/workspaces/${this.workspaceId}/rest/${connectionId}/invoke`,
      body ?? {},
    );
  }
}

export default EltClient;
