type RealtimeClientBaseOptions = {
    baseUrl: string;
    timeoutMs?: number;
};
export type EltRealtimeClientOptions = RealtimeClientBaseOptions & ({
    projectKey: string;
    projectSecret: string;
    workspaceId: number;
    getAccessToken?: never;
} | {
    getAccessToken: () => Promise<string | null> | string | null;
    projectKey?: never;
    projectSecret?: never;
    workspaceId?: never;
});
type EventHandler = (...args: unknown[]) => void;
export declare class EltRealtimeClient {
    private http;
    private tokenPath;
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
