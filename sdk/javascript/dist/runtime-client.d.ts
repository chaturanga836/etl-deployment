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
}
