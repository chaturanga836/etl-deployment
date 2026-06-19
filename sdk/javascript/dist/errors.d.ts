export declare class EltClientError extends Error {
    readonly statusCode: number;
    readonly detail?: unknown;
    constructor(message: string, statusCode: number, detail?: unknown);
}
