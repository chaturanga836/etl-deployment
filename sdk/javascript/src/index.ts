export {
  EltClientError,
  DtorchApiError,
  DtorchAuthError,
  DtorchMigrationError,
  DtorchServiceNotEnabledError,
  DtorchValidationError,
} from "./errors";
export {
  EltClient,
  EltClient as DtorchClient,
  type EltClientOptions,
  type EltClientOptions as DtorchClientOptions,
} from "./elt-client";
export {
  EltRuntimeClient,
  EltRuntimeClient as DtorchRuntimeClient,
  type EltRuntimeClientOptions,
  type EltRuntimeClientOptions as DtorchRuntimeClientOptions,
} from "./runtime-client";
export {
  EltRealtimeClient,
  EltRealtimeClient as DtorchRealtimeClient,
  type EltRealtimeClientOptions,
  type EltRealtimeClientOptions as DtorchRealtimeClientOptions,
} from "./realtime-client";
export { channelForUser, channelForWorkspace, channelNamed } from "./channels";
export {
  EltPlatformClient,
  EltPlatformClient as DtorchPlatformClient,
  type EltPlatformClientOptions,
  type EltPlatformClientOptions as DtorchPlatformClientOptions,
} from "./platform-client";
export { DatabaseContext } from "./database/database-context";
export { TableModel, type FindManyOptions } from "./database/table-model";
export * from "./types/database";
export * from "./types/studio";

import { EltClient as DtorchClient } from "./elt-client";
export default DtorchClient;
