"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DtorchMigrationError = exports.DtorchValidationError = exports.DtorchServiceNotEnabledError = exports.DtorchAuthError = exports.DtorchApiError = exports.EltClientError = void 0;
class EltClientError extends Error {
    constructor(message, statusCode, detail) {
        super(message);
        this.name = "EltClientError";
        this.statusCode = statusCode;
        this.detail = detail;
    }
}
exports.EltClientError = EltClientError;
/** Base error for all DT Orch API failures. */
class DtorchApiError extends EltClientError {
    constructor(message, statusCode, detail) {
        super(message, statusCode, detail);
        this.name = "DtorchApiError";
    }
}
exports.DtorchApiError = DtorchApiError;
/** Authentication or authorization failed. */
class DtorchAuthError extends DtorchApiError {
    constructor(message, statusCode, detail) {
        super(message, statusCode, detail);
        this.name = "DtorchAuthError";
    }
}
exports.DtorchAuthError = DtorchAuthError;
/** A requested workspace service has not been enabled. */
class DtorchServiceNotEnabledError extends DtorchApiError {
    constructor(service, message, detail) {
        super(message ?? `DT Orch service '${service}' is not enabled`, 404, detail);
        this.name = "DtorchServiceNotEnabledError";
        this.service = service;
    }
}
exports.DtorchServiceNotEnabledError = DtorchServiceNotEnabledError;
/** Invalid local SDK input or configuration. */
class DtorchValidationError extends DtorchApiError {
    constructor(message, detail) {
        super(message, 0, detail);
        this.name = "DtorchValidationError";
    }
}
exports.DtorchValidationError = DtorchValidationError;
/** A database migration request failed. */
class DtorchMigrationError extends DtorchApiError {
    constructor(message, statusCode, detail) {
        super(message, statusCode, detail);
        this.name = "DtorchMigrationError";
    }
}
exports.DtorchMigrationError = DtorchMigrationError;
