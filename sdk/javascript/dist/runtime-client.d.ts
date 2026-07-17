export type EltRuntimeClientOptions = {
    baseUrl: string;
    apiKey: string;
    workspaceId: number;
    timeoutMs?: number;
};
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
    /** Publish realtime notification (requires `notification:publish` scope). */
    notificationPublish(channel: string, payload?: Record<string, unknown>, target?: Record<string, unknown>): Promise<{
        channel: string;
        recipient_count: number;
        published: boolean;
    }>;
}
