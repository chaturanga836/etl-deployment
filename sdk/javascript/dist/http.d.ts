export type RequestAuth = {
    type: "jwt";
    getAccessToken?: () => Promise<string | null> | string | null;
} | {
    type: "project";
    projectKey: string;
    projectSecret: string;
} | {
    type: "apiKey";
    apiKey: string;
};
export type HttpClientOptions = {
    baseUrl: string;
    auth: RequestAuth;
    timeoutMs?: number;
};
export declare function requestJson<T>(options: HttpClientOptions, method: string, path: string, body?: unknown): Promise<T>;
