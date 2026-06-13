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

export default EltClient;
