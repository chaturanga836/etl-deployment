export type EltRealtimeClientOptions = {
    baseUrl: string;
    getAccessToken: () => Promise<string | null> | string | null;
    timeoutMs?: number;
};
type EventHandler = (...args: unknown[]) => void;
export declare class EltRealtimeClient {
    private http;
    private centrifuge;
    private subscriptions;
    constructor(options: EltRealtimeClientOptions);
    connect(): Promise<void>;
    subscribe(channel: string, handler: (data: unknown) => void): void;
    unsubscribe(channel: string): void;
    on(event: "connected" | "disconnected" | "error", handler: EventHandler): void;
    disconnect(): void;
}
export {};
