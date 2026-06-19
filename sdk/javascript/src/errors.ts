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
