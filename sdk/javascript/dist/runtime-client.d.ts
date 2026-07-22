type RuntimeClientBaseOptions = {
    baseUrl: string;
    workspaceId: number;
    timeoutMs?: number;
};
export type EltRuntimeClientOptions = RuntimeClientBaseOptions & ({
    projectKey: string;
    projectSecret: string;
    apiKey?: never;
} | {
    apiKey: string;
    projectKey?: never;
    projectSecret?: never;
});
export declare class EltRuntimeClient {
    private http;
    private workspaceId;
    constructor(options: EltRuntimeClientOptions);
    runPipeline(pipelineUuid: string, input?: Record<string, unknown>): Promise<{
        run_id: number;
        status: string;
    }>;
    runWorkflow(workflowUuid: string, input?: Record<string, unknown>): Promise<{
        run_id: number;
        status: string;
    }>;
    invokeRest(connectionId: number, body?: {
        path?: string;
        method?: string;
        variables?: Record<string, unknown>;
        body?: Record<string, unknown>;
    }): Promise<{
        status_code: number;
        data: unknown;
        headers?: Record<string, unknown>;
    }>;
    /** Push a message (requires `queue:push` scope). */
    queuePush(queueName: string, payload?: Record<string, unknown>): Promise<{
        id: number;
        payload: unknown;
        created_at?: string;
    }>;
    /** Pop oldest message — destructive; returns null when empty (requires `queue:pop` scope). */
    queuePop(queueName: string): Promise<{
        id: number;
        payload: unknown;
        created_at?: string;
    } | null>;
    /** Peek at the oldest message without removing it (requires `queue:read` scope). */
    queuePeek(queueName: string): Promise<{
        id: number;
        payload: unknown;
        created_at?: string;
    } | null>;
    /** Publish realtime notification (requires `notification:publish` scope). */
    notificationPublish(channel: string, payload?: Record<string, unknown>, target?: Record<string, unknown>): Promise<{
        channel: string;
        recipient_count: number;
        published: boolean;
    }>;
    /**
     * Push a cron history log entry (requires `cron:log` scope).
     * Always callable; platform stores the row only when the job has history_log enabled.
     */
    cronPushLogs(jobName: string, entry: {
        message: string;
        level?: string;
        metadata?: Record<string, unknown>;
    }): Promise<{
        accepted: boolean;
        reason?: string | null;
        id?: number | null;
        created_at?: string | null;
    }>;
}
export {};
