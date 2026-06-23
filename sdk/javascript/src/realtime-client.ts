import { Centrifuge, type Subscription } from "centrifuge";
import { requestJson, type HttpClientOptions } from "./http";

export type EltRealtimeClientOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string | null> | string | null;
  timeoutMs?: number;
};

type EventHandler = (...args: unknown[]) => void;

export class EltRealtimeClient {
  private http: HttpClientOptions;
  private centrifuge: Centrifuge | null = null;
  private subscriptions = new Map<string, Subscription>();

  constructor(options: EltRealtimeClientOptions) {
    this.http = {
      baseUrl: options.baseUrl,
      auth: { type: "jwt", getAccessToken: options.getAccessToken },
      timeoutMs: options.timeoutMs ?? 60_000,
    };
  }

  async connect(): Promise<void> {
    const tokenRes = await requestJson<{ token: string; ws_url: string }>(
      this.http,
      "GET",
      "/api/v1/notifications/realtime-token",
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
