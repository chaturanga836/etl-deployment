export declare class EltClientError extends Error {
    readonly statusCode: number;
    readonly detail?: unknown;
    constructor(message: string, statusCode: number, detail?: unknown);
}
/** Base error for all DT Orch API failures. */
export declare class DtorchApiError extends EltClientError {
    constructor(message: string, statusCode: number, detail?: unknown);
}
/** Authentication or authorization failed. */
export declare class DtorchAuthError extends DtorchApiError {
    constructor(message: string, statusCode: number, detail?: unknown);
}
/** A requested workspace service has not been enabled. */
export declare class DtorchServiceNotEnabledError extends DtorchApiError {
    readonly service: string;
    constructor(service: string, message?: string, detail?: unknown);
}
/** Invalid local SDK input or configuration. */
export declare class DtorchValidationError extends DtorchApiError {
    constructor(message: string, detail?: unknown);
}
/** A database migration request failed. */
export declare class DtorchMigrationError extends DtorchApiError {
    constructor(message: string, statusCode: number, detail?: unknown);
}
