"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EltClientError = void 0;
class EltClientError extends Error {
    constructor(message, statusCode, detail) {
        super(message);
        this.name = "EltClientError";
        this.statusCode = statusCode;
        this.detail = detail;
    }
}
exports.EltClientError = EltClientError;
