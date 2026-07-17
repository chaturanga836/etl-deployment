export class EltClientError extends Error {
  readonly statusCode: number;
  readonly detail?: unknown;

  constructor(message: string, statusCode: number, detail?: unknown) {
    super(message);
    this.name = "EltClientError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/** Base error for all DT Orch API failures. */
export class DtorchApiError extends EltClientError {
  constructor(message: string, statusCode: number, detail?: unknown) {
    super(message, statusCode, detail);
    this.name = "DtorchApiError";
  }
}

/** Authentication or authorization failed. */
export class DtorchAuthError extends DtorchApiError {
  constructor(message: string, statusCode: number, detail?: unknown) {
    super(message, statusCode, detail);
    this.name = "DtorchAuthError";
  }
}

/** A requested workspace service has not been enabled. */
export class DtorchServiceNotEnabledError extends DtorchApiError {
  readonly service: string;

  constructor(service: string, message?: string, detail?: unknown) {
    super(message ?? `DT Orch service '${service}' is not enabled`, 404, detail);
    this.name = "DtorchServiceNotEnabledError";
    this.service = service;
  }
}

/** Invalid local SDK input or configuration. */
export class DtorchValidationError extends DtorchApiError {
  constructor(message: string, detail?: unknown) {
    super(message, 0, detail);
    this.name = "DtorchValidationError";
  }
}

/** A database migration request failed. */
export class DtorchMigrationError extends DtorchApiError {
  constructor(message: string, statusCode: number, detail?: unknown) {
    super(message, statusCode, detail);
    this.name = "DtorchMigrationError";
  }
}
