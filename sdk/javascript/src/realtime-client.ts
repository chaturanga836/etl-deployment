import { Centrifuge, type Subscription } from "centrifuge";
import { requestJson, type HttpClientOptions } from "./http";

type RealtimeClientBaseOptions = {
  baseUrl: string;
  timeoutMs?: number;
};

export type EltRealtimeClientOptions = RealtimeClientBaseOptions & (
  | {
      projectKey: string;
      projectSecret: string;
      workspaceId: number;
      getAccessToken?: never;
    }
  | {
      getAccessToken: () => Promise<string | null> | string | null;
      projectKey?: never;
      projectSecret?: never;
      workspaceId?: never;
    }
);

type EventHandler = (...args: unknown[]) => void;

export class EltRealtimeClient {
  private http: HttpClientOptions;
  private tokenPath: string;
  private centrifuge: Centrifuge | null = null;
  private subscriptions = new Map<string, Subscription>();

  constructor(options: EltRealtimeClientOptions) {
    this.http = {
      baseUrl: options.baseUrl,
      auth: "projectKey" in options && options.projectKey !== undefined
        ? {
            type: "project",
            projectKey: options.projectKey,
            projectSecret: options.projectSecret,
          }
        : { type: "jwt", getAccessToken: options.getAccessToken },
      timeoutMs: options.timeoutMs ?? 60_000,
    };
    this.tokenPath = "projectKey" in options && options.projectKey !== undefined
      ? `/api/v1/workspaces/${options.workspaceId}/notifications/realtime-token`
      : "/api/v1/notifications/realtime-token";
  }

  async connect(): Promise<void> {
    const tokenRes = await requestJson<{ token: string; ws_url: string }>(
      this.http,
      "GET",
      this.tokenPath,
    );
    this.centrifuge = new Centrifuge(tokenRes.ws_url, { token: tokenRes.token });
    this.centrifuge.connect();
  }

  subscribe(channel: string, handler: (data: unknown) => void): void {
    if (!this.centrifuge) {
      throw new Error("Not connected — call connect() first");
    }
    const sub = this.centrifuge.newSubscription(channel);
    sub.on("publication", (ctx) => handler(ctx.data));
    sub.subscribe();
    this.subscriptions.set(channel, sub);
  }

  unsubscribe(channel: string): void {
    const sub = this.subscriptions.get(channel);
    if (sub) {
      sub.unsubscribe();
      sub.removeAllListeners();
      this.subscriptions.delete(channel);
    }
  }

  on(event: "connected" | "disconnected" | "error", handler: EventHandler): void {
    if (!this.centrifuge) {
      throw new Error("Not connected — call connect() first");
    }
    this.centrifuge.on(event, handler);
  }

  disconnect(): void {
    for (const channel of [...this.subscriptions.keys()]) {
      this.unsubscribe(channel);
    }
    this.centrifuge?.disconnect();
    this.centrifuge = null;
  }
}
