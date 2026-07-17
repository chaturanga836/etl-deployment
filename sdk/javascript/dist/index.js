"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TableModel = exports.DatabaseContext = exports.DtorchPlatformClient = exports.EltPlatformClient = exports.channelNamed = exports.channelForWorkspace = exports.channelForUser = exports.DtorchRealtimeClient = exports.EltRealtimeClient = exports.DtorchRuntimeClient = exports.EltRuntimeClient = exports.DtorchClient = exports.EltClient = exports.DtorchValidationError = exports.DtorchServiceNotEnabledError = exports.DtorchMigrationError = exports.DtorchAuthError = exports.DtorchApiError = exports.EltClientError = void 0;
var errors_1 = require("./errors");
Object.defineProperty(exports, "EltClientError", { enumerable: true, get: function () { return errors_1.EltClientError; } });
Object.defineProperty(exports, "DtorchApiError", { enumerable: true, get: function () { return errors_1.DtorchApiError; } });
Object.defineProperty(exports, "DtorchAuthError", { enumerable: true, get: function () { return errors_1.DtorchAuthError; } });
Object.defineProperty(exports, "DtorchMigrationError", { enumerable: true, get: function () { return errors_1.DtorchMigrationError; } });
Object.defineProperty(exports, "DtorchServiceNotEnabledError", { enumerable: true, get: function () { return errors_1.DtorchServiceNotEnabledError; } });
Object.defineProperty(exports, "DtorchValidationError", { enumerable: true, get: function () { return errors_1.DtorchValidationError; } });
var elt_client_1 = require("./elt-client");
Object.defineProperty(exports, "EltClient", { enumerable: true, get: function () { return elt_client_1.EltClient; } });
Object.defineProperty(exports, "DtorchClient", { enumerable: true, get: function () { return elt_client_1.EltClient; } });
var runtime_client_1 = require("./runtime-client");
Object.defineProperty(exports, "EltRuntimeClient", { enumerable: true, get: function () { return runtime_client_1.EltRuntimeClient; } });
Object.defineProperty(exports, "DtorchRuntimeClient", { enumerable: true, get: function () { return runtime_client_1.EltRuntimeClient; } });
var realtime_client_1 = require("./realtime-client");
Object.defineProperty(exports, "EltRealtimeClient", { enumerable: true, get: function () { return realtime_client_1.EltRealtimeClient; } });
Object.defineProperty(exports, "DtorchRealtimeClient", { enumerable: true, get: function () { return realtime_client_1.EltRealtimeClient; } });
var channels_1 = require("./channels");
Object.defineProperty(exports, "channelForUser", { enumerable: true, get: function () { return channels_1.channelForUser; } });
Object.defineProperty(exports, "channelForWorkspace", { enumerable: true, get: function () { return channels_1.channelForWorkspace; } });
Object.defineProperty(exports, "channelNamed", { enumerable: true, get: function () { return channels_1.channelNamed; } });
var platform_client_1 = require("./platform-client");
Object.defineProperty(exports, "EltPlatformClient", { enumerable: true, get: function () { return platform_client_1.EltPlatformClient; } });
Object.defineProperty(exports, "DtorchPlatformClient", { enumerable: true, get: function () { return platform_client_1.EltPlatformClient; } });
var database_context_1 = require("./database/database-context");
Object.defineProperty(exports, "DatabaseContext", { enumerable: true, get: function () { return database_context_1.DatabaseContext; } });
var table_model_1 = require("./database/table-model");
Object.defineProperty(exports, "TableModel", { enumerable: true, get: function () { return table_model_1.TableModel; } });
__exportStar(require("./types/database"), exports);
__exportStar(require("./types/studio"), exports);
const elt_client_2 = require("./elt-client");
exports.default = elt_client_2.EltClient;
