export { EltClientError } from "./errors";
export { EltClient, type EltClientOptions } from "./elt-client";
export { EltRuntimeClient, type EltRuntimeClientOptions } from "./runtime-client";
export { EltRealtimeClient, type EltRealtimeClientOptions } from "./realtime-client";
export { channelForUser, channelForWorkspace, channelNamed } from "./channels";
export { EltPlatformClient, type EltPlatformClientOptions } from "./platform-client";
export { DatabaseContext } from "./database/database-context";
export { TableModel, type FindManyOptions } from "./database/table-model";
export * from "./types/database";
export * from "./types/studio";

import { EltClient } from "./elt-client";
export default EltClient;
